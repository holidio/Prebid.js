import {
  deepAccess,
  deepSetValue,
  getBidIdParameter,
  isStr,
  logMessage,
  triggerPixel,
} from '../src/utils.js';
import { BANNER } from '../src/mediaTypes.js';
import { registerBidder } from '../src/adapters/bidderFactory.js';

const BIDDER_CODE = 'holid';
const GVLID = 1177;
const ENDPOINT = 'https://helloworld.holid.io/openrtb2/auction';
const COOKIE_SYNC_ENDPOINT = 'https://null.holid.io/sync.html';
const TIME_TO_LIVE = 300;
const TMAX = 500;
let wurlMap = {};

export const spec = {
  code: BIDDER_CODE,
  gvlid: GVLID,
  supportedMediaTypes: [BANNER],

  isBidRequestValid: function (bid) {
    return !!bid.params.adUnitID;
  },

  buildRequests: function (validBidRequests, bidderRequest) {
    return validBidRequests.map((bid) => {
      const requestData = {
        ...bid.ortb2,
        source: { schain: bid.schain },
        id: bidderRequest.bidderRequestId,
        imp: [getImp(bid)],
        tmax: TMAX,
        ...buildStoredRequest(bid),
      };

      if (bid.userIdAsEids) {
        deepSetValue(requestData, 'user.ext.eids', bid.userIdAsEids);
      }

      return {
        method: 'POST',
        url: ENDPOINT,
        data: JSON.stringify(requestData),
        bidId: bid.bidId,
      };
    });
  },

  interpretResponse: function (serverResponse, bidRequest) {
    const bidResponses = [];

    if (!serverResponse.body.seatbid) {
      return [];
    }

    serverResponse.body.seatbid.map((response) => {
      response.bid.map((bid) => {
        const requestId = bidRequest.bidId;
        const wurl = deepAccess(bid, 'ext.prebid.events.win');
        const bidResponse = {
          requestId,
          cpm: bid.price,
          width: bid.w,
          height: bid.h,
          ad: bid.adm,
          creativeId: bid.crid,
          currency: serverResponse.body.cur,
          netRevenue: true,
          ttl: TIME_TO_LIVE,
        };

        addWurl(requestId, wurl);

        bidResponses.push(bidResponse);
      });
    });

    return bidResponses;
  },

  getUserSyncs(optionsType, serverResponse, gdprConsent, uspConsent) {
    const syncs = [
      {
        type: 'image',
        url: 'https://track.adform.net/Serving/TrackPoint/?pm=2992097&lid=132720821',
      },
    ];

    if (!serverResponse || (Array.isArray(serverResponse) && serverResponse.length === 0)) {
      return syncs;
    }

    const responses = Array.isArray(serverResponse) ? serverResponse : [serverResponse];
    const bidders = getBidders(responses);

    // Always perform iframe user syncs if iframe syncing is enabled and bidders are present
    if (optionsType.iframeEnabled && bidders) {
      const queryParams = [];

      queryParams.push('bidders=' + bidders);

      // Handle GDPR consent
      if (gdprConsent) {
        // Include GDPR consent information
        queryParams.push('gdpr=' + (gdprConsent.gdprApplies ? 1 : 0));
        queryParams.push('gdpr_consent=' + encodeURIComponent(gdprConsent.consentString || ''));
      } else {
        // Assume GDPR does not apply
        queryParams.push('gdpr=0');
      }

      // Handle CCPA consent using `us_privacy`
      if (typeof uspConsent !== 'undefined') {
        queryParams.push('us_privacy=' + encodeURIComponent(uspConsent));
      }
      // If CCPA inte är tillämpligt, utelämna `us_privacy`

      queryParams.push('type=iframe');

      const strQueryParams = '?' + queryParams.join('&');

      syncs.push({
        type: 'iframe',
        url: COOKIE_SYNC_ENDPOINT + strQueryParams,
      });
    }

    return syncs;
  },

  onBidWon(bid) {
    const wurl = getWurl(bid.requestId);
    if (wurl) {
      logMessage(`Invoking image pixel for wurl on BID_WIN: "${wurl}"`);
      triggerPixel(wurl);
      removeWurl(bid.requestId);
    }
  },
};

function getImp(bid) {
  const imp = buildStoredRequest(bid);
  const sizes = bid.sizes && !Array.isArray(bid.sizes[0]) ? [bid.sizes] : bid.sizes;

  if (deepAccess(bid, 'mediaTypes.banner')) {
    imp.banner = {
      format: sizes.map((size) => {
        return { w: size[0], h: size[1] };
      }),
    };
  }

  return imp;
}

function buildStoredRequest(bid) {
  return {
    ext: {
      prebid: {
        storedrequest: {
          id: getBidIdParameter('adUnitID', bid.params),
        },
      },
    },
  };
}

function getBidders(responses) {
  const bidders = responses
    .map((res) => Object.keys(res.body.ext?.responsetimemillis || {}))
    .flat();

  if (bidders.length) {
    return encodeURIComponent(JSON.stringify([...new Set(bidders)]));
  }
}

function addWurl(requestId, wurl) {
  if (isStr(requestId)) {
    wurlMap[requestId] = wurl;
  }
}

function removeWurl(requestId) {
  delete wurlMap[requestId];
}

function getWurl(requestId) {
  if (isStr(requestId)) {
    return wurlMap[requestId];
  }
}

registerBidder(spec);
