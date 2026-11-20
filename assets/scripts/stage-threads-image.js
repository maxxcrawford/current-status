require('dotenv').config();
const { readData } = require('../../lib/publisher-common');
const { stageThreadsImage } = require('../../lib/threads-image');

stageThreadsImage(readData().posts[0], {
  sourceBaseUrl: process.env.SOURCE_BASE_URL || 'https://current-status.com',
}).then((url) => {
  console.log(url ? 'Temporary Threads JPEG staged.' : 'Threads can use the original JPEG/PNG.');
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
