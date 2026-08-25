(function() {
	"use strict";

	const userData = {
		fullName: "Maxx Crawford",
		userName: "woodenwarship"
	}

	const userFullNameDiv = document.querySelectorAll(".user-profile-full-name");
	const userUserNameDiv = document.querySelectorAll(".user-profile-username");

	userFullNameDiv.forEach( el => {
		el.textContent = userData.fullName;
	});

	userUserNameDiv.forEach( el => {
		el.textContent = "@" + userData.userName;
	});

	const postDate = document.querySelectorAll(".post-date");
	const postCount = document.getElementById("postCount");

	if (postCount) {
		postCount.textContent = postDate.length;
	}

	const linkedPosts = document.querySelectorAll(".post[data-permalink]");

	linkedPosts.forEach(post => {
		post.addEventListener("click", event => {
			if (event.target.closest("a, .post-content-container-image")) {
				return;
			}

			window.location.assign(post.dataset.permalink);
		});
	});

	const images = document.querySelectorAll(".post-content-container-image");

	let callback = (entries, observer) => {
		entries.map((entry) => {
			if (entry.isIntersecting) {
			entry.target.classList.remove("loading");
				const bg = entry.target.dataset.img;
				entry.target.style.backgroundImage = "url('" + bg + "')";
				observer.unobserve(entry.target);
			}
		});
	};

	let observer = new IntersectionObserver(callback);

	images.forEach((img) => {
		img.style.backgroundColor = img.dataset.color;
		observer.observe(img);
	});

	// Load first five elements on load
	// for (let index = 0; index < 5; index++) {
	// 	const currentImage = images[index];
	// 	currentImage.classList.remove("loading");
	// 	var bg = currentImage.dataset.img;
	// 	currentImage.style.backgroundImage = "url('" + bg + "')";	
	// }

})();
