const { test, expect } = require('@playwright/test');
const { posts } = require('../../data.json');

test.beforeEach(async ({ page }) => {
  // Exercise the site without depending on Google Fonts or the icon CDN.
  await page.route('https://**/*', route => route.abort());
});

test('automatically appends the next batch and initializes its images', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-permalink]')).toHaveCount(30);
  await expect(page.locator('#postCount')).toHaveText(String(posts.length));
  await page.locator('[data-feed-next]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-permalink]')).toHaveCount(60);
  const appended = page.locator('[data-permalink]').nth(30);
  await appended.scrollIntoViewIfNeeded();
  await expect(appended.locator('.post-content-container-image')).toHaveCSS('background-image', /url\(/);
  await expect(page.locator('[data-feed-announcement]')).toHaveText('30 more posts loaded.');
  expect(await page.locator('[data-permalink]').evaluateAll(elements =>
    new Set(elements.map(el => el.dataset.permalink)).size)).toBe(60);
});

test('a failed batch keeps existing posts and allows an explicit retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/page/2/', async route => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await page.goto('/');
  await page.locator('[data-feed-next]').scrollIntoViewIfNeeded();
  await expect(page.getByRole('link', { name: 'Retry loading posts' })).toBeVisible();
  await expect(page.locator('[data-permalink]')).toHaveCount(30);
  expect(attempts).toBe(1);
  await page.getByRole('link', { name: 'Retry loading posts' }).click();
  await expect(page.locator('[data-permalink]')).toHaveCount(60);
  expect(attempts).toBe(2);
});

test('Back restores appended posts and the reading position', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-feed-next]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-permalink]')).toHaveCount(60);
  const post = page.locator('[data-permalink]').nth(33);
  await post.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => scrollY);
  const href = await post.locator('.post-date').getAttribute('href');
  await post.locator('.post-date').click();
  await expect(page).toHaveURL(href);
  await page.goBack();
  await expect(page.locator('[data-permalink]')).toHaveCount(60);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(y, -1);
  // Exercise the saved snapshot too, rather than relying solely on the browser's back/forward cache.
  await page.reload();
  await expect(page.locator('[data-permalink]')).toHaveCount(60);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(y, -1);
});

test('the final batch stops loading and announces the remaining posts', async ({ page }) => {
  const lastPage = Math.ceil(posts.length / 30);
  await page.goto(`/page/${lastPage - 1}/`);
  await page.locator('[data-feed-next]').scrollIntoViewIfNeeded();
  const remaining = posts.length % 30 || 30;
  await expect(page.locator('[data-permalink]')).toHaveCount(30 + remaining);
  await expect(page.locator('[data-feed-next]')).toHaveCount(0);
  await expect(page.locator('[data-feed-announcement]')).toHaveText(`${remaining} more posts loaded.`);
});

test('static page links work without JavaScript and the last page has no next link', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route('https://**/*', route => route.abort());
  await page.goto('http://127.0.0.1:3101/');
  await expect(page.locator('[data-permalink]')).toHaveCount(30);
  await expect(page.locator('#postCount')).toHaveText(String(posts.length));
  await page.getByRole('link', { name: 'Load more posts' }).click();
  await expect(page).toHaveURL(/\/page\/2\/$/);
  await expect(page.locator('[data-permalink]').first()).toHaveAttribute('data-permalink', `/${posts[30].guid.slice(1)}/`);
  await page.goto(`http://127.0.0.1:3101/page/${Math.ceil(posts.length / 30)}/`);
  await expect(page.locator('[data-feed-next]')).toHaveCount(0);
  await context.close();
});

test('mobile feeds and single posts retain their layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await page.goto(`/${posts[0].guid.slice(1)}/`);
  await expect(page.locator('[data-feed-next]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  expect(await page.locator('.feed').evaluate(el => el.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(812);
});

test('initial styling needs no stylesheet requests and the LCP image has high priority', async ({ page }) => {
  const stylesheets = [];
  page.on('request', request => {
    if (request.resourceType() === 'stylesheet') stylesheets.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('style[data-site-styles]')).toHaveCount(1);
  await expect(page.locator('img[src="/assets/img/header-640.webp"]')).toHaveAttribute('fetchpriority', 'high');
  await expect(page.locator('img[src="/assets/img/header-640.webp"]')).toHaveAttribute('loading', 'eager');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [...document.fonts].some(font =>
    font.family === 'Work Sans' && font.status === 'loaded'))).toBe(true);
  expect(stylesheets).toEqual([]);
  // The profile background URL must remain valid with inline CSS on nested post URLs.
  await page.goto(`/${posts[0].guid.slice(1)}/`);
  await expect(page.locator('.user-profile-image').first()).toHaveCSS('background-image', /\/assets\/img\/profile-48\.webp/);
});

for (const scale of [1, 2]) {
  test(`header and profile images select appropriately sized sources at ${scale}x`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: scale });
    const page = await context.newPage();
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.route('https://**/*', route => route.abort());
    await page.goto('http://127.0.0.1:3101/');
    const header = page.getByAltText('Oil pumpjacks operating across a flat, arid Texas landscape beneath a cloudy sky');
    const profile = page.getByAltText('Maxx Crawford', { exact: true });
    await expect.poll(() => header.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect.poll(() => profile.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await header.evaluate(img => img.currentSrc)).toContain(`/header-${scale === 1 ? 640 : 1280}.webp`);
    expect(await profile.evaluate(img => img.currentSrc)).toContain(`/profile-${scale === 1 ? 112 : 224}.webp`);
    expect(requests.some(url => /\/assets\/img\/(header|profile)\.jpg/.test(url))).toBe(false);
    await context.close();
  });
}
