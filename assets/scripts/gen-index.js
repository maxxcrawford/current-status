const Fs = require('fs');
const Path = require('path');
const { imageSize } = require('image-size');

const rootDir = Path.resolve(__dirname, '../..');
const dataPath = Path.join(rootDir, 'data.json');
const indexPath = Path.join(rootDir, 'index.html');
const outputDir = Path.join(rootDir, 'dist');
const siteUrl = 'https://current-status.com';

const staticFiles = [
  'favicon.ico',
  'favicon.png',
  'share.png',
  'assets/style.css',
  'assets/scripts/app.js',
  'assets/img',
];

const generatedComment = '<!-- This file was generated from data.json. -->';

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function postId(post) {
  return String(post.guid || '').replace(/^#/, '');
}

function validatePosts(posts) {
  const seenIds = new Set();

  for (const post of posts) {
    const id = postId(post);

    if (!/^\d{8}T\d{4}$/.test(id)) {
      throw new Error(`Invalid post ID "${id}". Expected YYYYMMDDTHHmm.`);
    }

    if (seenIds.has(id)) {
      throw new Error(`Duplicate post ID "${id}".`);
    }

    seenIds.add(id);
  }
}

function fullImageForHtml(image) {
  return String(image || '').replace(/^https:\/\/current-status\.com\//, 'current-status.com/');
}

function displayImageForHtml(image) {
  const value = String(image || '');

  if (/^(?:https?:)?\/\//.test(value) || value.startsWith('/')) {
    return value;
  }

  return `/${value}`;
}

function permalinkForPost(post) {
  return `/${postId(post)}/`;
}

function imageDetailsForPost(post) {
  const displayImage = String(post.displayImage || '');
  const extension = Path.extname(displayImage.split(/[?#]/, 1)[0]).slice(1).toLowerCase();
  const mimeSubtype = extension === 'jpg' || extension === 'jpeg'
    ? 'jpeg'
    : extension === 'svg'
      ? 'svg+xml'
      : extension;

  if (/^https?:\/\//.test(displayImage)) {
    return mimeSubtype ? { type: `image/${mimeSubtype}` } : {};
  }

  const relativePath = displayImage.replace(/^\//, '');
  const imagePath = Path.resolve(rootDir, relativePath);

  if (!relativePath || !imagePath.startsWith(`${rootDir}${Path.sep}`)) {
    throw new Error(`Invalid local image path for post "${postId(post)}".`);
  }

  const dimensions = imageSize(Fs.readFileSync(imagePath));
  const detectedMimeSubtype = dimensions.type === 'jpg'
    ? 'jpeg'
    : dimensions.type === 'svg'
      ? 'svg+xml'
      : dimensions.type;

  return {
    width: dimensions.width,
    height: dimensions.height,
    type: `image/${detectedMimeSubtype}`,
  };
}

function aspectRatioClass(ratio) {
  const match = String(ratio || '').match(/^(\d+)-(\d+)$/);

  if (!match) {
    return 'aspect-video';
  }

  const height = Number(match[1]);
  const width = Number(match[2]);

  if (!Number.isInteger(height) || !Number.isInteger(width) || height <= 0 || width <= 0) {
    return 'aspect-video';
  }

  return `aspect-[${width}/${height}]`;
}

const POST_ITEM_CLASSES = 'post dark:!border-[#444]';
const USER_FULL_NAME_CLASSES = 'user-profile-full-name mr-2 text-black dark:!text-white font-bold text-base sm:text-lg';
const USER_USERNAME_CLASSES = 'user-profile-username mr-2 text-gray-600 dark:!text-[#999]';
const POST_DATE_CLASSES = 'post-date relative text-gray-600 dark:!text-[#999]';
const POST_IMAGE_CLASSES = 'loading post-content-container-image dark:opacity-75';

function displayDateForPost(post, currentYear = new Date().getFullYear()) {
  const id = postId(post);
  const year = Number(id.slice(0, 4));
  const month = Number(id.slice(4, 6));
  const day = Number(id.slice(6, 8));
  const monthName = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][month - 1];

  if (!monthName) {
    throw new Error(`Invalid month in post ID "${id}".`);
  }

  return year === currentYear ? `${monthName} ${day}` : `${monthName} ${day}, ${year}`;
}

function renderPost(post) {
  const id = postId(post);
  const ratioClass = post.ratio ? ` ratio-${post.ratio}` : '';
  const aspectClass = aspectRatioClass(post.ratio);
  const fullTime = post.fullTime || '';
  const imageAltDesc = post.imageAltDesc || '';

  return `      <li class="${POST_ITEM_CLASSES}" data-permalink="${escapeAttr(permalinkForPost(post))}">
        <div id="${escapeAttr(id)}" class="flex items-start p-4">
          <div class="user-profile-image w-8 h-8 sm:w-12 sm:h-12 bg-cover bg-black mr-2 flex-shrink-0"></div>
          <div class="post-container">
            <div class="user-profile-info flex items-baseline mb-2 text-sm">
              <div class="${USER_FULL_NAME_CLASSES}"></div>
              <div class="${USER_USERNAME_CLASSES}">@woodenwarship</div>
              <div class="text-gray-600 mr-2">&bull;</div>
              <a href="${escapeAttr(permalinkForPost(post))}" class="${POST_DATE_CLASSES}" data-full-date="${escapeAttr(fullTime)}" aria-label="${escapeAttr(fullTime)}">${escapeAttr(displayDateForPost(post))}</a>
            </div>
            <div class="post-content-container">
              <p class="mt-0">current status:</p>
              <div role="img" aria-label="${escapeAttr(imageAltDesc)}" data-full-image="${escapeAttr(fullImageForHtml(post.image))}" data-img="${escapeAttr(displayImageForHtml(post.displayImage))}" data-color="${escapeAttr(post.color)}" class="${POST_IMAGE_CLASSES}${ratioClass} ${aspectClass}"></div>
            </div>
          </div>
        </div>
      </li>`;
}

function dateTimeForPost(post) {
  const id = postId(post);
  return `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}`;
}

function renderPermalinkPost(post) {
  const id = postId(post);
  const ratioClass = post.ratio ? ` ratio-${post.ratio}` : '';
  const aspectClass = aspectRatioClass(post.ratio);
  const fullTime = post.fullTime || '';
  const imageAltDesc = post.imageAltDesc || '';

  return `      <li class="${POST_ITEM_CLASSES}">
        <article id="${escapeAttr(id)}" class="p-4">
          <div class="flex items-center mb-4">
            <div class="user-profile-image w-12 h-12 bg-cover bg-black mr-3 flex-shrink-0"></div>
            <div class="min-w-0">
              <div class="user-profile-full-name text-black dark:!text-white font-bold text-lg">Maxx Crawford</div>
              <div class="user-profile-username text-gray-600 dark:!text-[#999]">@woodenwarship</div>
            </div>
          </div>
          <div class="post-content-container">
            <p class="mt-0">current status:</p>
            <div role="img" aria-label="${escapeAttr(imageAltDesc)}" data-full-image="${escapeAttr(fullImageForHtml(post.image))}" data-img="${escapeAttr(displayImageForHtml(post.displayImage))}" data-color="${escapeAttr(post.color)}" class="${POST_IMAGE_CLASSES}${ratioClass} ${aspectClass}"></div>
            <time class="block mt-3 text-gray-600 dark:!text-[#999]" datetime="${escapeAttr(dateTimeForPost(post))}">${escapeAttr(fullTime)}</time>
          </div>
        </article>
      </li>`;
}

function replacePostList(template, posts, trailingHtml = '', renderPostItem = renderPost) {
  const firstPostMatch = template.match(/      <li class="post(?: [^"]*)?">/);
  if (!firstPostMatch) {
    throw new Error('Could not find the first post in index.html.');
  }

  const firstPostIndex = firstPostMatch.index;
  const closingUlIndex = template.indexOf('</ul>', firstPostIndex);
  if (closingUlIndex === -1) {
    throw new Error('Could not find the feed closing </ul> in index.html.');
  }

  const closingLineStart = template.lastIndexOf('\n', closingUlIndex) + 1;
  const postsHtml = posts.map(renderPostItem).join('\n');

  const trailing = trailingHtml ? `\n${trailingHtml}` : '';

  return `${template.slice(0, firstPostIndex)}${postsHtml}${trailing}\n\n${template.slice(closingLineStart)}`;
}

function addGeneratedComment(html) {
  return html.replace(
    /^<!DOCTYPE html>\n/,
    `<!DOCTYPE html>\n${generatedComment}\n`
  );
}

function replaceMetaContent(html, selector, content) {
  const escapedContent = escapeAttr(content);
  const pattern = new RegExp(`(<meta ${selector} content=")[^"]*(" ?/?>)`);

  if (!pattern.test(html)) {
    throw new Error(`Could not find metadata tag: ${selector}`);
  }

  return html.replace(pattern, `$1${escapedContent}$2`);
}

function renderPostNavigation(newerPost, olderPost) {
  if (!newerPost && !olderPost) {
    return '';
  }

  const newerLink = newerPost
    ? `<a class="text-blue-500 flex items-center gap-2" rel="prev" href="${escapeAttr(permalinkForPost(newerPost))}"><i class="fa-solid fa-arrow-left-long" aria-hidden="true"></i> Newer post</a>`
    : '<span></span>';
  const olderLink = olderPost
    ? `<a class="text-blue-500 flex items-center gap-2" rel="next" href="${escapeAttr(permalinkForPost(olderPost))}">Older post <i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i></a>`
    : '<span></span>';

  return `      <li aria-label="Post navigation" class="flex justify-between gap-4 p-4">
        ${newerLink}
        ${olderLink}
      </li>`;
}

function addPermalinkHeader(html) {
  const homeHeader = `    <div class="container max-w-screen-sm mx-auto py-4 text-xl text-center">
      <span data-hover="current status" class="relative inline-block px-3 py-1 bg-black text-white">current status: </span>
    </div>`;
  const permalinkHeader = `    <div class="container max-w-screen-sm mx-auto px-4 py-4 flex items-center gap-6">
      <a aria-label="Back to all posts" class="flex items-center gap-4 text-black dark:text-white" href="/">
        <i class="fa-solid fa-arrow-left-long" aria-hidden="true"></i>
        <span class="text-xl font-bold">Post</span>
      </a>
    </div>`;

  if (!html.includes(homeHeader)) {
    throw new Error('Could not find the home-page header in index.html.');
  }

  return html.replace(homeHeader, permalinkHeader);
}

function removeFullProfileHeader(html) {
  const sectionStart = html.indexOf('    <section data-profile-header');
  if (sectionStart === -1) {
    throw new Error('Could not find the full profile header in index.html.');
  }

  const sectionEnd = html.indexOf('    </section>', sectionStart);
  if (sectionEnd === -1) {
    throw new Error('Could not find the end of the full profile header in index.html.');
  }

  return `${html.slice(0, sectionStart)}${html.slice(sectionEnd + '    </section>\n'.length)}`;
}

function removeIndexBackToTop(html) {
  const linkStart = html.indexOf('  <a data-index-back-to-top');
  if (linkStart === -1) {
    throw new Error('Could not find the index back-to-top link in index.html.');
  }

  const linkEnd = html.indexOf('  </a>', linkStart);
  if (linkEnd === -1) {
    throw new Error('Could not find the end of the index back-to-top link in index.html.');
  }

  return `${html.slice(0, linkStart)}${html.slice(linkEnd + '  </a>\n'.length)}`;
}

function renderPermalinkPage(template, post, newerPost, olderPost, imageDetails) {
  const id = postId(post);
  const canonicalUrl = `${siteUrl}/${id}/`;
  const description = 'Maxx Crawford (@woodenwarship) on current-status.com';
  const imageAlt = post.imageAltDesc || 'Current status image posted by Maxx Crawford.';
  let html = removeFullProfileHeader(template);
  html = removeIndexBackToTop(html);
  html = replacePostList(html, [post], renderPostNavigation(newerPost, olderPost), renderPermalinkPost);
  html = addPermalinkHeader(html);

  html = html.replace('<title>current status</title>', `<title>current status: ${escapeAttr(post.fullTime || id)}</title>`);
  html = html.replace(
    '<link rel="canonical" href="https://current-status.com/">',
    `<link rel="canonical" href="${escapeAttr(canonicalUrl)}">`
  );
  html = replaceMetaContent(html, 'name="description"', description);
  html = replaceMetaContent(html, 'property="og:description"', description);
  html = replaceMetaContent(html, 'property="og:image"', post.image);
  html = replaceMetaContent(html, 'property="og:url"', canonicalUrl);
  html = replaceMetaContent(html, 'property="og:type"', 'article');
  html = replaceMetaContent(html, 'name="twitter:description"', description);
  html = replaceMetaContent(html, 'name="twitter:image"', post.image);
  const structuredImageMetadata = [
    imageDetails.type && `    <meta property="og:image:type" content="${escapeAttr(imageDetails.type)}" />`,
    imageDetails.width && `    <meta property="og:image:width" content="${escapeAttr(imageDetails.width)}" />`,
    imageDetails.height && `    <meta property="og:image:height" content="${escapeAttr(imageDetails.height)}" />`,
    `    <meta property="og:image:alt" content="${escapeAttr(imageAlt)}" />`,
    `    <meta name="twitter:image:alt" content="${escapeAttr(imageAlt)}">`,
  ].filter(Boolean).join('\n');
  html = html.replace(
    '    <meta property="og:url"',
    `${structuredImageMetadata}\n    <meta property="og:url"`
  );

  return addGeneratedComment(html);
}

function expectedOutputs(template, posts, getImageDetails = imageDetailsForPost) {
  const outputs = new Map();
  outputs.set('index.html', addGeneratedComment(replacePostList(template, posts)));

  posts.forEach((post, index) => {
    const relativePath = Path.join(postId(post), 'index.html');
    outputs.set(
      relativePath,
      renderPermalinkPage(template, post, posts[index - 1], posts[index + 1], getImageDetails(post))
    );
  });

  return outputs;
}

function copyStaticFile(relativePath) {
  const sourcePath = Path.join(rootDir, relativePath);
  if (!Fs.existsSync(sourcePath)) {
    return;
  }

  const destinationPath = Path.join(outputDir, relativePath);
  Fs.mkdirSync(Path.dirname(destinationPath), { recursive: true });
  Fs.cpSync(sourcePath, destinationPath, {
    recursive: true,
    filter: (source) => Path.basename(source) !== '.DS_Store',
  });
}

function prepareOutputDir() {
  Fs.rmSync(outputDir, { recursive: true, force: true });
  Fs.mkdirSync(outputDir, { recursive: true });
  staticFiles.forEach(copyStaticFile);
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const data = JSON.parse(Fs.readFileSync(dataPath, 'utf8'));
  const template = Fs.readFileSync(indexPath, 'utf8');
  validatePosts(data.posts);
  const outputs = expectedOutputs(template, data.posts);

  if (checkOnly) {
    const mismatches = [...outputs].filter(([relativePath, expected]) => {
      const outputPath = Path.join(outputDir, relativePath);
      const current = Fs.existsSync(outputPath) ? Fs.readFileSync(outputPath, 'utf8') : '';
      return expected !== current;
    });

    if (mismatches.length === 0) {
      console.log(`All ${outputs.size} generated HTML files are up to date.`);
      return;
    }

    console.error(`${mismatches.length} generated HTML file(s) are not up to date. Run npm run build.`);
    process.exitCode = 1;
    return;
  }

  prepareOutputDir();
  for (const [relativePath, html] of outputs) {
    const outputPath = Path.join(outputDir, relativePath);
    Fs.mkdirSync(Path.dirname(outputPath), { recursive: true });
    Fs.writeFileSync(outputPath, html);
  }
  console.log(`Generated the feed and ${data.posts.length} permalink pages from data.json.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  addPermalinkHeader,
  displayDateForPost,
  displayImageForHtml,
  expectedOutputs,
  imageDetailsForPost,
  permalinkForPost,
  removeFullProfileHeader,
  removeIndexBackToTop,
  renderPermalinkPage,
  renderPermalinkPost,
  renderPost,
  renderPostNavigation,
  validatePosts,
};
