var request = require("request-promise");
const { createWriteStream } = require('fs');
const { Transform } = require("json2csv");
const { Readable } = require('stream');
var sleep = require('sleep');

const INSTAGRAM_ACCOUNT_NAME_TO_MINE = 'niketraining';
const INSTAGRAM_QUERY_POST_HASH = 'e769aa130647d2354c40ea6a439bfc08'; // this may change periodically
const INSTAGRAM_QUERY_COMMENT_HASH = 'bc3296d1ce80a24b1b6e40b1e72903f5'; // this may change periodically

const transformOpts = { objectMode: true };
const accountOpts = { 
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

const postsOpts = { 
  fields: [
    'id',
    'shortcode',
    'video_view_count',
    'is_video',
    'video_duration',
    'type',
    'image_height',
    'image_width',
    'caption',
    'comment_count',
    'comments',
    'title',
    'likes'
  ] 
};

const commentsOpts = { 
  fields: [
    'id',
    'shortcode',
    'text',
    'created_at',
    'username',
    'likes',
    'comment_count'
  ] 
};

const accountsInput = new Readable({ objectMode: true });
accountsInput._read = () => {};
const accountsOutput = createWriteStream('./accounts.csv', { encoding: 'utf8' });
const accountsProcessor = accountsInput.pipe(new Transform(accountOpts, transformOpts)).pipe(accountsOutput);

const postsInput = new Readable({ objectMode: true });
postsInput._read = () => {};
const postsOutput = createWriteStream('./posts.csv', { encoding: 'utf8' });
const postsProcessor = postsInput.pipe(new Transform(postsOpts, transformOpts)).pipe(postsOutput);

const commentsInput = new Readable({ objectMode: true });
commentsInput._read = () => {};
const commentsOutput = createWriteStream('./comments.csv', { encoding: 'utf8' });
const commentsProcessor = commentsInput.pipe(new Transform(commentsOpts, transformOpts)).pipe(commentsOutput);

async function main() {
  var accountInfo = await getAccountInfo(INSTAGRAM_ACCOUNT_NAME_TO_MINE);
  await getPostsForAccount(INSTAGRAM_ACCOUNT_NAME_TO_MINE, accountInfo.id);
}

async function getAccountInfo(accountName) {
  var options = _getRequestOptions(accountName);
  var response = await _makeRequest(options);
  var userObject = response.user;
  
  var accountInfo = {
    id: userObject.id,
    username: userObject.username,
    biography: userObject.biography.replace(/[\n\r,]/g, ''),
    external_url: userObject.external_url,
    full_name: userObject.full_name,
    has_channel: userObject.has_channel,
    highlight_reel_count: userObject.highlight_reel_count,
    is_business_account: userObject.is_business_account,
    business_category_name: userObject.business_category_name,
    followed_by_count: userObject.edge_followed_by.count,
    follows_count: userObject.edge_follow.count,
    follows_follower_count: userObject.edge_mutual_followed_by.count,
    video_count: userObject.edge_felix_video_timeline.count,
    timeline_count: userObject.edge_owner_to_timeline_media.count,
  };
  accountsInput.push(accountInfo);

  return accountInfo;
}

async function getPostsForAccount(accountName, id) {
  var options = _getRequestOptions(accountName);
  var response = await _makeRequest(options);

  // start extracting information for the user's posts
  var localPosts = response.user.edge_owner_to_timeline_media;
  var pageInfo = localPosts.page_info;

  while (pageInfo.has_next_page) {
    try {
      // get the current count of posts in this page and iterate over each
      var countInCurrentPage = localPosts.edges.length;
      for (i = 0; i < countInCurrentPage; i++) {
        var postShortCode = localPosts.edges[i].node.shortcode;
        var post = await getIndividualPost(postShortCode);
        postsInput.push(post);
      }

      var pageVariable = JSON.stringify({ "id": `${id}`, "first": 25, "after": `${pageInfo.end_cursor}` });
      var urlOverride = `https://www.instagram.com/graphql/query/?query_hash=${INSTAGRAM_QUERY_POST_HASH}&variables=${encodeURIComponent(pageVariable)}`;
      var options = _getRequestOptions(null, null, null, urlOverride);
      var response = await _makeRequest(options);

      pageInfo.has_next_page = response.user.edge_owner_to_timeline_media.page_info;
      localPosts = response.user.edge_owner_to_timeline_media;
    } catch (error) {
      console.error("Encountered error while processing post data.", error);
    }
  }
}

async function getIndividualPost(shortCode) {
  var options = _getRequestOptions(null, shortCode);
  var response = await _makeRequest(options);
  var postMedia = response.shortcode_media;
  return {
    id: postMedia.id,
    shortcode: postMedia.shortcode,
    video_view_count: postMedia.video_view_count,
    is_video: postMedia.is_video,
    video_duration: postMedia.video_duration,
    type: postMedia.__typename,
    image_height: postMedia.dimensions.height,
    image_width: postMedia.dimensions.width,
    caption: postMedia.edge_media_to_caption.edges[0] ? postMedia.edge_media_to_caption.edges[0].node.text.replace(/[\n\r,]/g, '') : '',
    comment_count: postMedia.edge_media_to_parent_comment.count,
    comments: await getComments(postMedia.edge_media_to_parent_comment, shortCode),
    title: postMedia.title ? postMedia.title.replace(/[\n\r,]/g, '') : '',
    likes: postMedia.edge_media_preview_like.count
  };
}


// short code
async function getComments(commentCollection, shortCode) {
  var pageInfo = commentCollection.page_info;
  var localCommentCollection = commentCollection;
  while (pageInfo.has_next_page) {
    try {
      // go through all the comments
      parseComments(localCommentCollection.edges, shortCode);

      // on next page, use below
      var commentVariables = JSON.stringify({ "shortcode": `${shortCode}`, "first": 25, "after": `${pageInfo.end_cursor}` });
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
}

function parseComments(commentNodes, shortCode) {
  for (i = 0; i < commentNodes.length; i++) {
    var comment = commentNodes[i].node;
    commentsInput.push({
      id: comment.id,
      shortcode: shortCode,
      text: comment.text ? comment.text.replace(/[\n\r,]/g, '') : '',
      created_at: comment.created_at,
      username: comment.owner.username,
      likes: comment.edge_liked_by.count,
      comment_count: comment.edge_threaded_comments.count
    });
  }
}

// Make request to url to get account information, 
// then get the body/json from the response and massage it to a more readable state.
// To see the full response, see: https://www.instagram.com/$accountName/?__a=1
async function _makeRequest(options) {
  console.log(`Getting information from url: ${options.url}`);

  try {
    var response = await request(options); // make a call to get the instagram info
    return response.body['graphql'] || response.body['data'];
  } catch (error) {
    console.error(error);
    console.warn("Was rate limited, waiting a minute to try again.")
    sleep.sleep(60)
    return await _makeRequest(options);
  }
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