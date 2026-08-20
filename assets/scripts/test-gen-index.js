const assert = require('assert/strict');
const Fs = require('fs');
const Path = require('path');

const {
  displayImageForHtml,
  expectedOutputs,
  imageDetailsForPost,
  permalinkForPost,
  renderPermalinkPage,
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

const renderedPost = renderPost(posts[0]);
assert.match(renderedPost, /href="\/20260819T2247\/"/);
assert.match(renderedPost, /data-img="\/assets\/img\/content\/20260819T2247\.png"/);

const navigation = renderPostNavigation(posts[0], posts[1]);
assert.match(navigation, /Newer post/);
assert.match(navigation, /Older post/);

const page = renderPermalinkPage(template, posts[0], undefined, posts[1], imageDetails);
assert.match(page, /<link rel="canonical" href="https:\/\/current-status\.com\/20260819T2247\/">/);
assert.match(page, /property="og:image" content="https:\/\/current-status\.com\/assets\/img\/content\/20260819T2247\.png"/);
assert.match(page, /property="og:image:alt" content="A game cover &amp; its title"/);
assert.match(page, /property="og:image:type" content="image\/png"/);
assert.match(page, /property="og:image:width" content="256"/);
assert.match(page, /property="og:image:height" content="324"/);
assert.match(page, /property="og:type" content="article"/);
assert.doesNotMatch(page, /(?:src|href)="assets\//);
assert.match(page, /src="\/assets\/img\/profile\.jpg"/);
assert.doesNotMatch(page, /20260818T1200" class="flex items-start/);
assert.match(page, /href="\/20260818T1200\/">Older post/);

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

console.log('permalink page generation tests passed.');
