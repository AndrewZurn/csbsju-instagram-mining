var request = require("request-promise");

const INSTAGRAM_ACCOUNT_NAME_TO_MINE = 'niketraining';
const INSTAGRAM_QUERY_HASH = 'bc3296d1ce80a24b1b6e40b1e72903f5'; // this may change periodically

async function main() {
  var accountInfo = await getAccountInfo(INSTAGRAM_ACCOUNT_NAME_TO_MINE);
  console.log(accountInfo); // TODO: Write this information to a csv file.

  var response = await getPostsForAccount(INSTAGRAM_ACCOUNT_NAME_TO_MINE);
  console.log(response);
}

async function getAccountInfo(accountName) {
  var options = _getRequestOptions(accountName);
  var response = await _makeRequest(options);
  var userObject = response.user;

  // move some keys around to flatten out the information
  userObject.follows_count = userObject.edge_follow.count;
  userObject.follows_follower_count = userObject.edge_mutual_followed_by.count;
  userObject.video_count = userObject.edge_felix_video_timeline.count;
  userObject.timeline_count = userObject.edge_owner_to_timeline_media.count;

  delete userObject['blocked_by_viewer'];
  delete userObject['followed_by_viewer'];
  delete userObject['external_url_linkshimmed'];
  delete userObject['country_block'];
  delete userObject['restricted_by_viewer'];
  delete userObject['edge_follow'];
  delete userObject['follows_viewer'];
  delete userObject['has_blocked_viewer'];
  delete userObject['has_requested_viewer'];
  delete userObject['highlight_reel_count'];
  delete userObject['is_private'];
  delete userObject['edge_mutual_followed_by'];
  delete userObject['profile_pic_url_hd'];
  delete userObject['requested_by_viewer'];
  delete userObject['edge_felix_video_timeline'];
  delete userObject['edge_owner_to_timeline_media'];
  delete userObject['edge_saved_media'];
  delete userObject['edge_media_collections'];

  console.log(`Successfully received information for account: ${accountName}`)
  return userObject;
}

async function getPostsForAccount(accountName) {
  var options = _getRequestOptions(accountName);
  var response = await _makeRequest(options);

  // start extracting information for the user's posts
  var posts = response.user.edge_owner_to_timeline_media;
  var totalPosts = posts.count;
  
  var pageInfo = posts.page_info;
  while (pageInfo.has_next_page) {
    try {
      // get the current count of posts in this page and iterate over each
      var countInCurrentPage = posts.edges.length;
      for (i = 0; i < countInCurrentPage; i++) {
        var postShortCode = posts.edges[i].node.shortcode;
        var post = await getIndividualPost(postShortCode)
        console.log(post);
      }

      // TODO: do the pagination correctly
      // use the end cursor to fetch the next set of results.
      // pageInfo = posts.page_info;
      // 
      return { totalPosts, pageInfo };
    } catch (error) {
      console.error("Encountered error while processing post data.", error)
    }
  }
}

async function getIndividualPost(shortCode) {
  var options = _getRequestOptions(null, shortCode);
  var response = await _makeRequest(options);
  var postMedia = response.shortcode_media;

  postMedia.type = postMedia.__typename;
  postMedia.image_height = postMedia.dimensions.height;
  postMedia.image_width = postMedia.dimensions.width;

  if (postMedia.edge_media_to_caption.edges[0]) {
    postMedia.caption = postMedia.edge_media_to_caption.edges[0].node.text.replace(/[\n\r,]/g,'');
  }

  // parse edge_media_to_parent_comment actual nodes
  postMedia.comment_count = postMedia.edge_media_to_parent_comment.count;
  // var comments = getComments(postMedia.edge_media_to_parent_comment);

  postMedia.title = postMedia.title.replace(/[\n\r,]/g,'');
  postMedia.likes = postMedia.edge_media_preview_like.count;
  
  delete postMedia.__typename;
  delete postMedia.dimensions;
  delete postMedia.gating_info;
  delete postMedia.fact_check_overall_rating;
  delete postMedia.fact_check_information;
  delete postMedia.media_preview;
  delete postMedia.display_resources;
  delete postMedia.dash_info;
  delete postMedia.tracking_token;
  delete postMedia.edge_media_to_tagged_user;
  delete postMedia.edge_media_to_parent_comment;
  delete postMedia.edge_media_preview_comment;
  delete postMedia.commenting_disabled_for_viewer;
  delete postMedia.edge_media_to_sponsor_user;
  delete postMedia.viewer_has_liked;
  delete postMedia.viewer_has_saved;
  delete postMedia.viewer_has_saved_to_collection;
  delete postMedia.viewer_in_photo_of_you;
  delete postMedia.viewer_can_reshare;
  delete postMedia.owner;
  delete postMedia.edge_web_media_to_related_media;
  delete postMedia.encoding_status;
  delete postMedia.thumbnail_src;

  return postMedia;
}

// short code
async function getComments(commentCollection, shortCode) {
  var count = commentCollection.count;
  var pageInfo = commentCollection.page_info;

  var localCommentCollection = commentCollection;

  var comments = [];
  while (pageInfo.has_next_page) {
    // go through all the comments
    comments = comments.push(parseComments(localCommentCollection.edges));

    // on next page, use below
    var commentVariables = {"shortcode":`${shortCode}`,"first":12,"after":`${page_info.end_cursor}`}
    var urlOverride = `https://www.instagram.com/graphql/query/?query_hash=${INSTAGRAM_QUERY_HASH}&variables=${encodeURIComponent(commentVariables)}`;
    var options = _getRequestOptions(null, null, null, urlOverride);
    var response = await _makeRequest(options);

    pageInfo = response.data.shortcode_media.edge_media_to_parent_comment.page_info;
    localCommentCollection = response.data.shortcode_media.edge_media_to_parent_comment;
  }

  return comments;
}

function parseComments(commentNodes) {
  for (i = 0; i < commentNodes.length; i++) {
    // parse the comments, return as an array
  }
}

// Make request to url to get account information, 
// then get the body/json from the response and massage it to a more readable state.
// To see the full response, see: https://www.instagram.com/$accountName/?__a=1
async function _makeRequest(options) {
  console.log(`Getting information from url: ${options.url}`)
  var response = await request(options); // make a call to get the instagram info
  return response.body['graphql'];
}

function _getRequestOptions(accountName, shortCode, pageCursor, urlOverride) {
  var queryString = { __a: '1' };
  if (pageCursor != null) {
    queryString.max_id = pageCursor;
  }

  var url = '';
  if (shortCode != null) {
    url = `https://www.instagram.com/p/${shortCode}/`;
  } else {
    url = `https://www.instagram.com/${accountName}/`;
  }

  if (urlOverride) {
    url = urlOverride;
  }

  return { 
    method: 'GET',
    url: url,
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