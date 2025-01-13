const dotenv = require('dotenv').config();
const masto = require('masto');
const Fs = require('fs');
const { exec } = require('child_process');

(async function() {
	"use strict";

    const { posts } = JSON.parse(Fs.readFileSync("./data.json", 'utf8'));

    
    
    async function createImageAttachment(post) {
        
        // Check if the file is local or remote
        if (post.image.startsWith("https://current-status.com/")) {
            console.log("starts-with TRUE")

            const imagePath = post.image.replace("https://current-status.com", ".");
            console.log(imagePath);

            return await mastoClient.v2.media.create({
                file: new Blob([Fs.readFileSync(imagePath)]),
                description: post.imageAltDesc,
            });
        } 

        // Fetch image if remote
        const remoteFile = await fetch(post.image);
        return await mastoClient.v2.media.create({
            file: await remoteFile.blob(),
            description: post.imageAltDesc,
        });
        
    }

    const mastoClient = masto.createRestAPIClient({
        url: dotenv.parsed.MASTODON_URL,
        accessToken: dotenv.parsed.MASTODON_TOKEN,
    });

    const attachment = await createImageAttachment(posts[0])

    console.log(attachment);

    // Publish!
    const status = await mastoClient.v1.statuses.create({
        status: "current status:",
        visibility: "public",
        mediaIds: [attachment.id],
    });

    console.log(status.url);
    exec(`open ${status.url}`);	
})();