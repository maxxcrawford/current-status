const assert = require('assert/strict');
const Fs = require('fs');
const Path = require('path');

const {
  displayDateForPost,
  displayImageForHtml,
  expectedOutputs,
  imageDetailsForPost,
  permalinkForPost,
  renderPermalinkPage,
  renderPermalinkPost,
  renderPost,
  renderPostNavigation,
  validatePosts,
} = require('./gen-index');

const template = Fs.readFileSync(Path.resolve(__dirname, '../../index.html'), 'utf8');
const posts = [
  {
    guid: '#20260819T2247',
    fullTime: '10:47 PM • August 19, 2026',
    image: 'https://current-status.com/assets/img/content/20260819T2247.png',
    displayImage: 'assets/img/content/20260819T2247.png',
    imageAltDesc: 'A game cover & its title',
    ratio: '5-4',
    color: '#392F39',
  },
  {
    guid: '#20260818T1200',
    fullTime: '12:00 PM • August 18, 2026',
    image: 'https://current-status.com/assets/img/content/20260818T1200.jpg',
    displayImage: 'assets/img/content/20260818T1200.jpg',
    imageAltDesc: 'An older image',
    ratio: '1-1',
    color: '#000000',
  },
];
const imageDetails = { width: 256, height: 324, type: 'image/png' };
const getImageDetails = () => imageDetails;

validatePosts(posts);
assert.throws(() => validatePosts([{ guid: '#not-an-id' }]), /Invalid post ID/);
assert.throws(() => validatePosts([posts[0], posts[0]]), /Duplicate post ID/);
assert.equal(permalinkForPost(posts[0]), '/20260819T2247/');
assert.equal(displayImageForHtml('assets/example.png'), '/assets/example.png');
assert.equal(displayDateForPost(posts[0], 2026), 'Aug 19');
assert.equal(displayDateForPost(posts[0], 2027), 'Aug 19, 2026');

const renderedPost = renderPost(posts[0]);
assert.match(renderedPost, /data-permalink="\/20260819T2247\/"/);
assert.match(renderedPost, /href="\/20260819T2247\/"/);
assert.match(renderedPost, /data-img="\/assets\/img\/content\/20260819T2247\.png"/);
assert.match(renderedPost, />Aug 19<\/a>/);
assert.match(renderedPost, /data-full-date="10:47 PM • August 19, 2026"/);
assert.doesNotMatch(renderedPost, /data-date=/);

const renderedPermalinkPost = renderPermalinkPost(posts[0]);
assert.doesNotMatch(renderedPermalinkPost, /data-permalink=/);
assert.match(renderedPermalinkPost, /Maxx Crawford/);
assert.match(renderedPermalinkPost, /@woodenwarship/);
assert.match(renderedPermalinkPost, /data-img="\/assets\/img\/content\/20260819T2247\.png"/);
assert.match(renderedPermalinkPost, /<time[^>]+datetime="2026-08-19T22:47"[^>]*>10:47 PM • August 19, 2026<\/time>/);
assert.equal(renderedPermalinkPost.indexOf('Maxx Crawford') < renderedPermalinkPost.indexOf('data-img='), true);
assert.equal(renderedPermalinkPost.indexOf('data-img=') < renderedPermalinkPost.indexOf('<time'), true);

const navigation = renderPostNavigation(posts[0], posts[1]);
assert.match(navigation, /Newer post/);
assert.match(navigation, /Older post/);
assert.match(navigation, /fa-arrow-left-long/);
assert.match(navigation, /fa-arrow-right-long/);
assert.doesNotMatch(navigation, /&larr;|&rarr;/);

const page = renderPermalinkPage(template, posts[0], undefined, posts[1], imageDetails);
assert.match(page, /<link rel="canonical" href="https:\/\/current-status\.com\/20260819T2247\/">/);
assert.match(page, /property="og:image" content="https:\/\/current-status\.com\/assets\/img\/content\/20260819T2247\.png"/);
assert.match(page, /property="og:image:alt" content="A game cover &amp; its title"/);
assert.match(page, /property="og:description" content="Maxx Crawford \(@woodenwarship\) on current-status\.com"/);
assert.match(page, /name="twitter:description" content="Maxx Crawford \(@woodenwarship\) on current-status\.com"/);
assert.doesNotMatch(page, /property="og:description" content="A game cover/);
assert.match(page, /property="og:image:type" content="image\/png"/);
assert.match(page, /property="og:image:width" content="256"/);
assert.match(page, /property="og:image:height" content="324"/);
assert.match(page, /property="og:type" content="article"/);
assert.match(page, /https:\/\/kit\.fontawesome\.com\/f42f48d217\.js/);
assert.match(page, /<header class="site-header sticky top-0 left-0 w-full z-10 shadow dark:text-white">/);
assert.match(page, /aria-label="Back to all posts" class="flex items-center gap-4/);
assert.match(page, /aria-label="Back to all posts"[^>]+href="\/">[\s\S]+fa-arrow-left-long[\s\S]+Post[\s\S]+<\/a>/);
assert.match(page, /<i class="fa-solid fa-arrow-left-long" aria-hidden="true"><\/i>/);
assert.match(page, /<span class="text-xl font-bold">Post<\/span>/);
assert.doesNotMatch(page, /(?:src|href)="assets\//);
assert.doesNotMatch(page, /data-profile-header|header\.jpg|id="postCount"|Joined Feb 2014|href="\/rss\.xml"/);
assert.doesNotMatch(page, /data-index-back-to-top|fa-arrow-up-long/);
assert.doesNotMatch(page, /20260818T1200" class="flex items-start/);
assert.match(page, /href="\/20260818T1200\/">Older post <i class="fa-solid fa-arrow-right-long"/);

const actualImageDetails = imageDetailsForPost({
  guid: '#20260819T2247',
  displayImage: 'assets/img/content/20260819T2247.png',
});
assert.deepEqual(actualImageDetails, imageDetails);
assert.deepEqual(
  imageDetailsForPost({ guid: '#20250331T2217', displayImage: 'https://media.giphy.com/example.gif' }),
  { type: 'image/gif' }
);

const firstOutputs = expectedOutputs(template, posts, getImageDetails);
const secondOutputs = expectedOutputs(template, posts, getImageDetails);
assert.deepEqual(firstOutputs, secondOutputs);
assert.equal(firstOutputs.size, 3);
assert.equal(firstOutputs.has(Path.join('20260819T2247', 'index.html')), true);
assert.match(firstOutputs.get('index.html'), /data-profile-header/);
assert.match(firstOutputs.get('index.html'), /id="postCount"/);
assert.match(firstOutputs.get('index.html'), /data-index-back-to-top[^>]+fixed z-\[100\] bottom-4 right-4 sm:hidden[^>]+href="#top"/);
assert.match(firstOutputs.get('index.html'), /fa-arrow-up-long/);
assert.doesNotMatch(firstOutputs.get('index.html'), /dayjs\.min\.js/);
assert.match(firstOutputs.get('index.html'), /<\/main>\n  <a data-index-back-to-top[\s\S]+<\/a>/);
assert.match(firstOutputs.get('index.html'), /<div class="mb-4">[\s\S]+id="postCount"/);
assert.match(firstOutputs.get('index.html'), /<div class="flex flex-wrap gap-x-4 gap-y-2">/);
assert.doesNotMatch(firstOutputs.get('index.html'), /mb-4 flex flex-wrap gap-x-4 gap-y-2/);
assert.doesNotMatch(firstOutputs.get('index.html'), /dark:!border-(?:x|b)-2/);

console.log('permalink page generation tests passed.');
