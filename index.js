var request = require("request-promise");

const INSTAGRAM_ACCOUNT_NAME_TO_MINE = 'niketraining';

async function main() {
  var accountInfo = await getAccountInfo(INSTAGRAM_ACCOUNT_NAME_TO_MINE);
  console.log(accountInfo);

  // var response = await getPostsForAccount(INSTAGRAM_ACCOUNT_NAME_TO_MINE);
  // console.log(response.body.graphql.user.edge_followed_by.count);
}

async function getAccountInfo(accountName) {
  var options = _getRequestOptions(accountName);

  // Make request to url to get account information, 
  // then get the body/json from the response and massage it to a more readable state.
  // To see the full response, see: https://www.instagram.com/$accountName/?__a=1
  console.log(`Getting information for account: ${accountName} - url: ${options.url}`)
  var response = await request(options); // make a call to get the instagram info for this accountName
  var accountInfo = response.body['graphql']['user'];

  // move some keys around to flatten out the information
  accountInfo['follows_count'] = accountInfo['edge_follow']['count'];
  accountInfo['follows_follower_count'] = accountInfo['edge_mutual_followed_by']['count'];
  accountInfo['video_count'] = accountInfo['edge_felix_video_timeline']['count'];
  accountInfo['timeline_count'] = accountInfo['edge_owner_to_timeline_media']['count']

  delete accountInfo['blocked_by_viewer'];
  delete accountInfo['followed_by_viewer'];
  delete accountInfo['external_url_linkshimmed'];
  delete accountInfo['country_block'];
  delete accountInfo['restricted_by_viewer'];
  delete accountInfo['edge_follow'];
  delete accountInfo['follows_viewer'];
  delete accountInfo['has_blocked_viewer'];
  delete accountInfo['has_requested_viewer'];
  delete accountInfo['highlight_reel_count'];
  delete accountInfo['is_private'];
  delete accountInfo['edge_mutual_followed_by'];
  delete accountInfo['profile_pic_url_hd'];
  delete accountInfo['requested_by_viewer'];
  delete accountInfo['edge_felix_video_timeline'];
  delete accountInfo['edge_owner_to_timeline_media'];
  delete accountInfo['edge_saved_media'];
  delete accountInfo['edge_media_collections'];

  console.log(`Successfully received information for account: ${accountName}`)
  return accountInfo;
}

async function getPostsForAccount(accountName) {
  var options = _getRequestOptions(accountName, null);
  return request(options);
}

async function getIndividualPost(shortCode) {

}

function _getRequestOptions(accountName, pageCursor) {
  var queryString = { __a: '1' };
  if (pageCursor != null) {
    queryString.max_id = pageCursor;
  } 

  return { 
    method: 'GET',
    url: `https://www.instagram.com/${accountName}/`,
    qs: queryString,
    headers: { 
      Connection: 'keep-alive',
    },
    resolveWithFullResponse: true,
    json: true
  };
}

// runs the main method/script
(async () => main())();