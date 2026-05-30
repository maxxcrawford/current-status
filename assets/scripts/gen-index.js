const Fs = require('fs');
const Path = require('path');

const rootDir = Path.resolve(__dirname, '../..');
const dataPath = Path.join(rootDir, 'data.json');
const indexPath = Path.join(rootDir, 'index.html');
const outputDir = Path.join(rootDir, 'dist');
const outputIndexPath = Path.join(outputDir, 'index.html');

const staticFiles = [
  'favicon.ico',
  'favicon.png',
  'share.png',
  'assets/style.css',
  'assets/scripts/app.js',
  'assets/scripts/dayjs.min.js',
  'assets/img',
];

const generatedCommentPattern = /^<!DOCTYPE html>\n<!-- This was generated at .+ -->\n/;

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

function fullImageForHtml(image) {
  return String(image || '').replace(/^https:\/\/current-status\.com\//, 'current-status.com/');
}

const POST_ITEM_CLASSES = 'post dark:!border-[#444] dark:!border-b-2';
const USER_FULL_NAME_CLASSES = 'user-profile-full-name mr-2 text-black dark:!text-white font-bold text-base sm:text-lg';
const USER_USERNAME_CLASSES = 'user-profile-username mr-2 text-gray-600 dark:!text-[#999]';
const POST_DATE_CLASSES = 'post-date relative text-gray-600 dark:!text-[#999]';
const POST_IMAGE_CLASSES = 'loading post-content-container-image dark:opacity-75';

function renderPost(post) {
  const id = postId(post);
  const ratioClass = post.ratio ? ` ratio-${post.ratio}` : '';
  const fullTime = post.fullTime || '';
  const imageAltDesc = post.imageAltDesc || '';

  return `      <li class="${POST_ITEM_CLASSES}">
        <div id="${escapeAttr(id)}" class="flex items-start p-4">
          <div class="user-profile-image w-8 h-8 sm:w-12 sm:h-12 bg-cover bg-black mr-2 flex-shrink-0"></div>
          <div class="post-container">
            <div class="user-profile-info flex items-baseline mb-2 text-sm">
              <div class="${USER_FULL_NAME_CLASSES}"></div>
              <div class="${USER_USERNAME_CLASSES}">@woodenwarship</div>
              <div class="text-gray-600 mr-2">&bull;</div>
              <a href="#${escapeAttr(id)}" class="${POST_DATE_CLASSES}" data-date="${escapeAttr(id)}" data-full-date="${escapeAttr(fullTime)}">${escapeAttr(fullTime)}</a>
            </div>
            <div class="post-content-container">
              <p class="mt-0">current status:</p>
              <div role="img" aria-label="${escapeAttr(imageAltDesc)}" data-full-image="${escapeAttr(fullImageForHtml(post.image))}" data-img="${escapeAttr(post.displayImage)}" data-color="${escapeAttr(post.color)}" class="${POST_IMAGE_CLASSES}${ratioClass}"></div>
            </div>
          </div>
        </div>
      </li>`;
}

function replacePostList(template, posts) {
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
  const postsHtml = posts.map(renderPost).join('\n');

  return `${template.slice(0, firstPostIndex)}${postsHtml}\n\n${template.slice(closingLineStart)}`;
}

function addGeneratedComment(html) {
  const generatedAt = new Date().toISOString();
  return html.replace(
    /^<!DOCTYPE html>\n/,
    `<!DOCTYPE html>\n<!-- This was generated at ${generatedAt} -->\n`
  );
}

function stripGeneratedComment(html) {
  return html.replace(generatedCommentPattern, '<!DOCTYPE html>\n');
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
  const nextIndex = addGeneratedComment(replacePostList(template, data.posts));

  if (checkOnly) {
    const currentOutput = Fs.existsSync(outputIndexPath)
      ? Fs.readFileSync(outputIndexPath, 'utf8')
      : '';

    const hasGeneratedComment = generatedCommentPattern.test(currentOutput);
    const indexMatches = stripGeneratedComment(nextIndex) === stripGeneratedComment(currentOutput);

    if (hasGeneratedComment && indexMatches) {
      console.log('dist/index.html is up to date.');
      return;
    }

    console.error('dist/index.html is not up to date. Run npm run build.');
    process.exitCode = 1;
    return;
  }

  prepareOutputDir();
  Fs.writeFileSync(outputIndexPath, nextIndex);
  console.log(`Generated dist/index.html from ${data.posts.length} posts in data.json.`);
}

main();
