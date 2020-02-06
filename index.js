var request = require("request-promise");
const { createWriteStream } = require('fs');
const { Transform } = require("json2csv");
const { Readable } = require('stream');

const INSTAGRAM_ACCOUNT_NAME_TO_MINE = 'niketraining';
const INSTAGRAM_QUERY_POST_HASH = 'e769aa130647d2354c40ea6a439bfc08'; // this may change periodically
const INSTAGRAM_QUERY_COMMENT_HASH = 'bc3296d1ce80a24b1b6e40b1e72903f5'; // this may change periodically

const transformOpts = { highWaterMark: 8192 };

async function main() {
  const accountOutputFile = createWriteStream('./accounts.csv', { encoding: 'utf8' });
  const postsOutputFile = createWriteStream('./posts.csv', { encoding: 'utf8' });
  const commentsOutputFile = createWriteStream('./comments.csv', { encoding: 'utf8' });

  var accountInfo = await getAccountInfo(INSTAGRAM_ACCOUNT_NAME_TO_MINE);
  const opts = { 
    fields: [
      'id',
      'biography',
      'external_url',
      'edge_followed_by',
      'full_name',
      'has_channel',
      'is_business_account',
      'is_joined_recently',
      'business_category_name',
      'is_verified',
      'profile_pic_url',
      'username',
      'connected_fb_page',
      'follows_count',
      'follows_follower_count',
      'video_count',
      'timeline_count'
    ] 
  };

  const input = new Readable({ objectMode: true });
  input._read = () => {};
  input.push(accountInfo);

  const output = createWriteStream('./accounts.csv', { encoding: 'utf8' });
  const transformOpts = { objectMode: true };

  const json2csv = new Transform(opts, transformOpts);
  const processor = input.pipe(json2csv).pipe(output);

  var postInfo = await getPostsForAccount(INSTAGRAM_ACCOUNT_NAME_TO_MINE, accountInfo.id);
  console.log(postInfo);
}

async function getAccountInfo(accountName) {
  var options = _getRequestOptions(accountName);
  var response = await _makeRequest(options);
  var userObject = response.user;

  // move some keys around to flatten out the information
  userObject.followed_by_count = userObject.edge_followed_by.count;
  userObject.follows_count = userObject.edge_follow.count;
  userObject.follows_follower_count = userObject.edge_mutual_followed_by.count;
  userObject.video_count = userObject.edge_felix_video_timeline.count;
  userObject.timeline_count = userObject.edge_owner_to_timeline_media.count;

  delete userObject['blocked_by_viewer'];
  delete userObject['followed_by_viewer'];
  delete userObject['edge_followed_by'];
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

async function getPostsForAccount(accountName, id) {
  var options = _getRequestOptions(accountName);
  var response = await _makeRequest(options);

  // start extracting information for the user's posts

  var localPosts = response.user.edge_owner_to_timeline_media;
  var pageInfo = localPosts.page_info;

  var posts = [];

  while (pageInfo.has_next_page) {
    try {
      // get the current count of posts in this page and iterate over each
      var countInCurrentPage = localPosts.edges.length;
      for (i = 0; i < countInCurrentPage; i++) {
        var postShortCode = localPosts.edges[i].node.shortcode;
        var post = await getIndividualPost(postShortCode);
        posts.push(post);
      }

      var pageVariable = JSON.stringify({ "id": `${id}`, "first": 12, "after": `${pageInfo.end_cursor}` });
      var urlOverride = `https://www.instagram.com/graphql/query/?query_hash=${INSTAGRAM_QUERY_POST_HASH}&variables=${encodeURIComponent(pageVariable)}`;
      var options = _getRequestOptions(null, null, null, urlOverride);
      var response = await _makeRequest(options);

      pageInfo = response.user.edge_owner_to_timeline_media.page_info;
      localPosts = response.user.edge_owner_to_timeline_media;

    } catch (error) {
      console.error("Encountered error while processing post data.", error);
    }
  }
  return posts;
}

async function getIndividualPost(shortCode) {
  var options = _getRequestOptions(null, shortCode);
  var response = await _makeRequest(options);
  var postMedia = response.shortcode_media;

  postMedia.type = postMedia.__typename;
  postMedia.image_height = postMedia.dimensions.height;
  postMedia.image_width = postMedia.dimensions.width;

  if (postMedia.edge_media_to_caption.edges[0]) {
    postMedia.caption = postMedia.edge_media_to_caption.edges[0].node.text.replace(/[\n\r,]/g, '');
  }

  // parse edge_media_to_parent_comment actual nodes
  postMedia.comment_count = postMedia.edge_media_to_parent_comment.count;
  postMedia.comments = await getComments(postMedia.edge_media_to_parent_comment, shortCode);
  console.log(postMedia.comments);

  postMedia.title = postMedia.title ? postMedia.title.replace(/[\n\r,]/g, '') : '';
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
  delete postMedia.edge_media_to_caption;
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
  var pageInfo = commentCollection.page_info;

  var localCommentCollection = commentCollection;

  var comments = [];
  while (pageInfo.has_next_page) {
    try {
      // go through all the comments
      comments = comments.concat(parseComments(localCommentCollection.edges));

      // on next page, use below
      var commentVariables = JSON.stringify({ "shortcode": `${shortCode}`, "first": 12, "after": `${pageInfo.end_cursor}` });
      var urlOverride = `https://www.instagram.com/graphql/query/?query_hash=${INSTAGRAM_QUERY_COMMENT_HASH}&variables=${encodeURIComponent(commentVariables)}`;
      var options = _getRequestOptions(null, null, null, urlOverride);
      var response = await _makeRequest(options);

      pageInfo = response.shortcode_media.edge_media_to_parent_comment.page_info;
      localCommentCollection = response.shortcode_media.edge_media_to_parent_comment;
    }
    catch (error) {
      console.error("Encountered error while processing comment data.", error);
    }
  }

  return comments;
}

function parseComments(commentNodes) {
  var comments = [];
  for (i = 0; i < commentNodes.length; i++) {
    var comment = commentNodes[i].node;
    comments.push({
      id: comment.id,
      text: comment.text ? comment.text.replace(/[\n\r,]/g, '') : '',
      created_at: comment.created_at,
      username: comment.owner.username,
      likes: comment.edge_liked_by.count,
      comment_count: comment.edge_threaded_comments.count
    });
  }
  return comments;
}

// Make request to url to get account information, 
// then get the body/json from the response and massage it to a more readable state.
// To see the full response, see: https://www.instagram.com/$accountName/?__a=1
async function _makeRequest(options) {
  console.log(`Getting information from url: ${options.url}`);
  var response = await request(options); // make a call to get the instagram info
  return response.body['graphql'] || response.body['data'];
}

function _getRequestOptions(accountName, shortCode, pageCursor, urlOverride) {
  var queryString = null;
  if (!urlOverride) {
    queryString = { __a: '1' };
  }
  else if (pageCursor != null) {
    queryString = { max_id: pageCursor };
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