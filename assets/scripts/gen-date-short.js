const Dayjs = require('dayjs');

function buildCurrentTime() {
		// 20210310T2306
		var now = Dayjs();
		return now.format('YYYYMMDDTHHmm');
	}

function pbcopy(data) {
	console.log(`${data} copied to clipboard`);
    var proc = require('child_process').spawn('pbcopy'); 
    proc.stdin.write(data); proc.stdin.end();
}

const currentTime = buildCurrentTime()

pbcopy(currentTime)

// function getFullTime(time){
// 	// let date = el.dataset.date;
// 	let dayjsDate = Dayjs(time);
// 	return dayjsDate.format("h:mm A • MMMM D, YYYY");
// }

// setTimeout(()=>{
// 	pbcopy(getFullTime(currentTime))
// }, 1000);

