const RSS = require('rss');
const Fs = require('fs');
const Dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')

Dayjs.extend(utc)
Dayjs.extend(timezone)
Dayjs.tz.setDefault("America/Chicago")

/* lets create an rss feed */
const feed = new RSS({
    title: 'current status',
    description: 'Twitter feed for one, please!',
    feed_url: 'http://current-status.com/rss.xml',
    site_url: 'http://current-status.com',
    image_url: 'https://current-status.com/favicon.png',
    copyright: '2024 Maxx Crawford',
    language: 'en',
    ttl: '1',
});

var posts = JSON.parse(Fs.readFileSync("./data.json", 'utf8'));

// console.log(posts);

function parsePostDate(date) {
    const trimDate = date.replace("#", "");
    const dayjsDate = Dayjs.tz(trimDate);
    return dayjsDate.format();
}

for (const post of posts.posts) {

    const date = parsePostDate(post.guid);

    feed.item({
        title:  'current status:',
        description: '',
        guid: post.guid,
        url: `https://current-status.com/${post.guid}`,
        author: 'Maxx Crawford', 
        date: date, 
        enclosure: {
            url: post.image
        },
    });
}


/* loop over data and add to feed */

 
// cache the xml to send to clients
var xml = feed.xml({indent: true});

// console.log(xml);

Fs.writeFileSync('rss.xml', xml);
