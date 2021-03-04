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

	postDate.forEach( el => {
		// TODO: Add hover element with full date
		let date = el.dataset.date;
		let dayjsDate = dayjs(date);
		let dayjsDateDisplay = dayjsDate.format("MMM D");
		let dayjsDateHover = dayjsDate.format("h:mm A • MMMM D, YYYY");
		el.textContent = dayjsDateDisplay;
		el.dataset.fullDate = dayjsDateHover

		// let span = document.createElement("span");
		// span.classList.add("post-date-full", "tooltip", "p-1", "rounded", "bg-red-500", "sm:bg-yellow-400", "md:bg-blue-500", "lg:bg-green-700");
		// span.textContent = dayjsDateHover

	});

})();
