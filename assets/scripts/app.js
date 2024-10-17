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

	postCount.textContent = postDate.length;

	const currentYear = dayjs().year();

	postDate.forEach( el => {
		// TODO: Add hover element with full date
		let date = el.dataset.date;
		let dayjsDate = dayjs(date);
		let postIsCurrentYear = dayjsDate.isSame(`${currentYear}-01-01`, 'y')

		let dayjsDateDisplay = postIsCurrentYear ? dayjsDate.format("MMM D") : dayjsDate.format("MMM D, YYYY")
		
		let dayjsDateHover = dayjsDate.format("h:mm A • MMMM D, YYYY");
		el.textContent = dayjsDateDisplay;
		el.dataset.fullDate = dayjsDateHover
		el.ariaLabel = dayjsDateHover;
		// let span = document.createElement("span");
		// span.classList.add("post-date-full", "tooltip", "p-1", "rounded", "bg-red-500", "sm:bg-yellow-400", "md:bg-blue-500", "lg:bg-green-700");
		// span.textContent = dayjsDateHover
	});

	function copyToClipboard() {
		const temp = document.createElement("textarea");
		const time = buildCurrentTime();
		document.body.appendChild(temp);
		temp.value = time;
		temp.select();
		document.execCommand("copy");
		document.body.removeChild(temp);
	}

	function buildCurrentTime() {
		// 20210310T2306
		var now = dayjs();
		return now.format('YYYYMMDDTHHmm');
	}

	const getTimeButton = document.getElementById("getTimeButton");
	getTimeButton.addEventListener("click", copyToClipboard, false);

	// Show time-clock only on local
	const currentWindow = window.location.toString();
	const isLocal = (currentWindow.includes("localhost"));
	
	if (isLocal) {
		getTimeButton.classList.remove("hidden");
	}
	
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
