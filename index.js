var fs = require('fs');
var request = require("request-promise");
const { createWriteStream } = require('fs');
const { Transform } = require("json2csv");
const { Readable } = require('stream');
var sleep = require('sleep');

const INSTAGRAM_ACCOUNT_NAME_TO_MINE = 'kaepernick7';
const INSTAGRAM_QUERY_TIMELINE_POST_HASH = '06f8942777d97c874d3d88066e5e3824'; // this may change periodically
const INSTAGRAM_QUERY_POST_HASH = 'e769aa130647d2354c40ea6a439bfc08'; // this may change periodically
const INSTAGRAM_QUERY_COMMENT_HASH = 'bc3296d1ce80a24b1b6e40b1e72903f5'; // this may change periodically
const INSTAGRAM_QUERY_CHILD_COMMENT_HASH = '1ee91c32fc020d44158a3192eda98247'; // this may change periodically

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
    'created_at',
    'shortcode',
    'video_view_count',
    'is_video',
    'video_duration',
    'type',
    'display_url',
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
    'parent_comment_id',
    'shortcode',
    'text',
    'created_at',
    'username',
    'likes',
    'comment_count'
  ] 
};

// make our ouput directories if it doesn't exist
if (!fs.existsSync(`./data/${INSTAGRAM_ACCOUNT_NAME_TO_MINE}`)){
  fs.mkdirSync(`./data/${INSTAGRAM_ACCOUNT_NAME_TO_MINE}`);
}

const todaysDate = (new Date()).toLocaleDateString().replace(/\//g, "-")
if (!fs.existsSync(`./data/${INSTAGRAM_ACCOUNT_NAME_TO_MINE}/${todaysDate}`)){
  fs.mkdirSync(`./data/${INSTAGRAM_ACCOUNT_NAME_TO_MINE}/${todaysDate}`);
}

// The following code handles writing data to csv files as it becomes available (as a stream of data items),
// rather than storing all the data in memory and then writing it at the end of the mining process.
// This ensure that we process doesn't crash due to the machine running out of memory, and ensures that accounts
// with a large amount of posts (such as Nike) can be partially minded and is not an all-or-nothing mining process.
// open a stream writer to write the acocunt data into the accounts csv file
const accountsInput = new Readable({ objectMode: true });
accountsInput._read = () => {};
const accountsOutput = createWriteStream(`./data/${INSTAGRAM_ACCOUNT_NAME_TO_MINE}/${todaysDate}/accounts.csv`, { encoding: 'utf8' });
const accountsProcessor = accountsInput.pipe(new Transform(accountOpts, transformOpts)).pipe(accountsOutput);

// open a stream writer to write the acocunt data into the posts csv file
const postsInput = new Readable({ objectMode: true });
postsInput._read = () => {};
const postsOutput = createWriteStream(`./data/${INSTAGRAM_ACCOUNT_NAME_TO_MINE}/${todaysDate}/posts.csv`, { encoding: 'utf8' });
const postsProcessor = postsInput.pipe(new Transform(postsOpts, transformOpts)).pipe(postsOutput);

// open a stream writer to write the acocunt data into the comments csv file
const commentsInput = new Readable({ objectMode: true });
commentsInput._read = () => {};
const commentsOutput = createWriteStream(`./data/${INSTAGRAM_ACCOUNT_NAME_TO_MINE}/${todaysDate}/comments.csv`, { encoding: 'utf8' });
const commentsProcessor = commentsInput.pipe(new Transform(commentsOpts, transformOpts)).pipe(commentsOutput);

async function main() {
  var accountInfo = await getAccountInfo(INSTAGRAM_ACCOUNT_NAME_TO_MINE);
  await getPostsForAccount(accountInfo.id, accountInfo.response);
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

  return { id: accountInfo.id, response };
}

async function getPostsForAccount(id, initialAccountResponse) {
  // extract the information from the initial posts (from the account call).
  var { hasNextPage, endCursor } = await parsePosts(initialAccountResponse);

  // because the first timeline query doesn't have comments on each post, we need to
  // make a call for each individual post to a details endpoint to get those comments
  var shortCodes = initialAccountResponse.user.edge_owner_to_timeline_media.edges.map(post => post.node.shortcode);
  await getTimelinePostsComments(shortCodes);

  while (hasNextPage) {
    try {
      var pageVariable = JSON.stringify({ "id": `${id}`, "first": 50, "after": `${endCursor}` });
      urlOverride = `https://www.instagram.com/graphql/query/?query_hash=${INSTAGRAM_QUERY_POST_HASH}&variables=${encodeURIComponent(pageVariable)}`;
      var options = _getRequestOptions(null, null, null, urlOverride);
      var response = await _makeRequest(options);
      var result = await parsePosts(response);
      hasNextPage = result.hasNextPage;
      endCursor = result.endCursor;
    } 
    catch (error) {
      console.error("Encountered error while processing post data.", error);
    }
  }
}

// Get the comments for the initial posts on the timeline (they initial structure does not have comments in it's payload)
async function getTimelinePostsComments(shortCodes) {
  shortCodes.forEach(async shortCode => {
    try {
      var pageVariable = JSON.stringify({ shortcode: shortCode, child_comment_count: 25, fetch_comment_count: 50, parent_comment_count: 50, has_threaded_comments: true });
      urlOverride = `https://www.instagram.com/graphql/query/?query_hash=${INSTAGRAM_QUERY_TIMELINE_POST_HASH}&variables=${encodeURIComponent(pageVariable)}`;
      var options = _getRequestOptions(null, null, null, urlOverride);
      var response = await _makeRequest(options);
      await parseComments(response.shortcode_media.edge_media_to_parent_comment, shortCode);
    } catch (error) {
      console.error("Encountered error while processing individual timeline post data.", error);
    }
  });
}

async function parsePosts(response) {
  var postMedia = response.user.edge_owner_to_timeline_media;
  var hasNextPage = postMedia.page_info.has_next_page;
  var endCursor = postMedia.page_info.end_cursor;

  for (var i = 0; i < postMedia.edges.length; i++) {
    var node = postMedia.edges[i].node;
    console.log(`Starting to parse shortCode: ${node.shortcode}`);
    await getComments(node.edge_media_to_comment, node.shortcode);

    postsInput.push({
      id: node.id,
      created_at: node.taken_at_timestamp,
      shortcode: node.shortcode,
      video_view_count: node.video_view_count,
      is_video: node.is_video,
      video_duration: node.video_duration,
      type: node.__typename,
      display_url: node.display_url,
      image_height: node.dimensions.height,
      image_width: node.dimensions.width,
      caption: node.edge_media_to_caption.edges[0] ? node.edge_media_to_caption.edges[0].node.text.replace(/[\n\r,]/g, '') : '',
      comment_count: node.edge_media_to_comment.count,
      title: node.title ? node.title.replace(/[\n\r,]/g, '') : '',
      likes: node.edge_media_preview_like.count
    });
  }

  return { hasNextPage, endCursor };
}

async function getComments(comments, shortCode) {
  var { hasNextPage, endCursor } = await parseComments(comments, shortCode, null);
  while (hasNextPage) {
    try {
      var commentVariables = JSON.stringify({ "shortcode": `${shortCode}`, "first": 50, "after": `${endCursor}` });
      var urlOverride = `https://www.instagram.com/graphql/query/?query_hash=${INSTAGRAM_QUERY_COMMENT_HASH}&variables=${encodeURIComponent(commentVariables)}`;
      var options = _getRequestOptions(null, null, null, urlOverride);
      var response = await _makeRequest(options);
      var result = await parseComments(response.shortcode_media.edge_media_to_parent_comment, shortCode, null);
      hasNextPage = result.hasNextPage;
      endCursor = result.endCursor;
    } catch (error) {
      console.error("Encountered error while processing comment data.", error);
    }
  }
}

async function getChildComments(comments, shortCode, parentCommentId) {
  console.log(`Getting child comments for parentCommentId: ${parentCommentId} and shortCode: ${shortCode}`);
  var { hasNextPage, endCursor } = await parseComments(comments, shortCode, parentCommentId);
  while (hasNextPage) {
    try {
      var commentVariables = JSON.stringify({ "comment_id": `${parentCommentId}`, "first": 50, "after": `${endCursor}` });
      var urlOverride = `https://www.instagram.com/graphql/query/?query_hash=${INSTAGRAM_QUERY_CHILD_COMMENT_HASH}&variables=${encodeURIComponent(commentVariables)}`;
      var options = _getRequestOptions(null, null, null, urlOverride);
      var response = await _makeRequest(options);
      var result = await parseComments(response.comment.edge_threaded_comments, shortCode, parentCommentId);
      hasNextPage = result.hasNextPage;
      endCursor = result.endCursor;
    } catch (error) {
      console.error("Encountered error while processing child comment data.", error);
    }
  }
}

function parseComments(comments, shortCode, parentCommentId) {
  // the posts from the initial page/url: https://www.instagram.com/niketraining/?__a=1 don't have comments on them...
  // we handle this above by getting the initial posts' comments through an additional query (made in: getTimelinePostsComments)
  if (!comments.page_info) {
    return { hasNextPage: false, endCursor: null };
  }

  console.log(`Getting ${comments.edges.length} comments for shortCode: ${shortCode}`);
  var hasNextPage = comments.page_info.has_next_page;
  var endCursor = comments.page_info.end_cursor;
  for (var i = 0; i < comments.edges.length; i++) {
    var comment = comments.edges[i].node;
    var commentId = comment.id;

    var childComments = comment.edge_threaded_comments;
    if (childComments && childComments.count > 0) {
      getChildComments(childComments, shortCode, commentId);
    }

    commentsInput.push({
      id: commentId,
      parent_comment_id: parentCommentId,
      shortcode: shortCode,
      text: comment.text ? comment.text.replace(/[\n\r,]/g, '') : '',
      created_at: comment.created_at,
      username: comment.owner.username,
      likes: comment.edge_liked_by && comment.edge_liked_by.count ? comment.edge_liked_by.count : '',
      comment_count: comment.edge_threaded_comments && comment.edge_threaded_comments.count ? comment.edge_threaded_comments.count : ''
    });
  }

  return { hasNextPage, endCursor };
}

// Make request to url to get account information, 
// then get the body/json from the response and massage it to a more readable state.
// To see the full response, open one of the URLs below in a browser.
// * Initial timeline page for account: https://www.instagram.com/$accountName/?__a=1
// * Additional posts for account: https://www.instagram.com/graphql/query/?query_hash=e769aa130647d2354c40ea6a439bfc08&variables=%7B%22id%22%3A%221415955173%22%2C%22first%22%3A25%2C%22after%22%3A%22QVFCYkRkMEZmTHVaeDN3bVo3WEt0aHk5b2dOeW5nRzF3M0NVZnZvZng2aVVKSmZiNnliamFiRW1ITWNKSkdvbjRfekpWcEJnVURCcnZFVDhaUXFfRm8tZw%3D%3D%22%7D
// * Additional comments on a post: https://www.instagram.com/graphql/query/?query_hash=bc3296d1ce80a24b1b6e40b1e72903f5&variables=%7B%22shortcode%22%3A%22BoUpR6yhxJG%22%2C%22first%22%3A100%2C%22after%22%3A%22QVFDZlBZZ0FZY2Q2dEVVVE1MREM0QmpFQWxBQnVlNUljVEhWN1c1bFZDM2I0UnAtV2hTU0szR2dRVzM1bWpGZzRyYVFDbUlVcHh1TGhUR3VwcFFTMEFnbQ%3D%3D%22%7D
// * Child comments of a parent comment: https://www.instagram.com/graphql/query/?query_hash=1ee91c32fc020d44158a3192eda98247&variables=%7B%22comment_id%22%3A%2217935811389217391%22%2C%22first%22%3A100%2C%22after%22%3A%22QVFCdjNXM09COG5SOFp1S2VpaGVReUt6bThVcjROVEUxUkJJY2toWUU3WnV5dXhVbWJQUzdtSkI0WU5uTHJKdTU2dmlLTkJvVkxlS1FnS3dFSXlCVDRaYw%3D%3D%22%7D
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
