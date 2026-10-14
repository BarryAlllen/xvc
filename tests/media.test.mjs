import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const context = {URL, console};
vm.runInNewContext(await readFile(new URL('../extension/media-core.js', import.meta.url), 'utf8'), context);
const core = context.XVCMedia;
const url = (id, quality = 720) => `https://video.twimg.com/ext_tw_video/${id}/pu/vid/avc1/${quality}/video.mp4?tag=12`;
const poster = id => `https://pbs.twimg.com/ext_tw_video_thumb/${id}/pu/img/image.jpg?name=small`;
const tweet = (id, mediaId) => ({rest_id: id, legacy: {extended_entities: {media: [{id_str: mediaId, type: 'video', media_url_https: poster(mediaId), video_info: {variants: [
  {content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/a.m3u8'},
  {content_type: 'video/mp4', bitrate: 256000, url: url(mediaId, 360)},
  {content_type: 'video/mp4', bitrate: 2048000, url: url(mediaId)}
]}}]}}});
test('only complete MP4 from the exact X CDN is accepted', () => {
  assert.equal(core.mp4URL(url('11')), url('11'));
  for (const value of ['https://video.twimg.com.evil.test/a.mp4', 'http://video.twimg.com/a.mp4', 'file:///tmp/a.mp4', 'blob:https://x.com/abc', 'https://user@video.twimg.com/a.mp4', 'https://video.twimg.com/a.m3u8', 'https://video.twimg.com:444/a.mp4']) assert.equal(core.mp4URL(value), null);
});
test('extract quoted tweet separately and select the hovered video rather than its parent', () => {
  const parent = tweet('100', '11'); parent.quoted_status_result = {result: tweet('200', '22')};
  const tweets = core.extractTweets({data: {instructions: [{entries: [parent]}]}});
  assert.equal(tweets.length, 2);
  assert.deepEqual(Array.from(core.selectVideo(tweets, {poster: poster('22'), tweetId: '100', videoCount: 2})), [url('22'), url('22', 360)]);
});
test('poster variations match, but stale/ambiguous metadata fails closed', () => {
  const tweets = core.extractTweets(tweet('100', '11'));
  assert.equal(core.selectVideo(tweets, {poster: poster('11').replace('small', 'large'), tweetId: '100'}).length, 2);
  assert.equal(core.selectVideo(tweets, {poster: poster('99'), tweetId: '100'}).length, 0);
  assert.equal(core.selectVideo(tweets, {tweetId: '100', videoCount: 2}).length, 0);
});
test('new X payload variants and malformed messages do not create arbitrary sources', () => {
  assert.equal(core.extractTweets({rest_id: 'x', legacy: {extended_entities: {media: []}}}).length, 0);
  assert.equal(core.sanitizeMedia({variants: [{url: 'file:///tmp/a.mp4'}]}), null);
  const cyclic = {}; cyclic.self = cyclic; assert.equal(core.extractTweets(cyclic).length, 0);
});
