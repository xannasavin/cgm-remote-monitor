...\cgm-remote-monitor\lib\client\clock-client.js

Before `// Color Background add`

````javascript
// Get current time
var tfudt = new Date();
var tfutime = tfudt.getHours();
var tfufromtime = 8;
var tfutilltime = 21;
var tfudaytime = false;
if (tfutime >= tfufromtime && tfutime <= tfutilltime) {
    tfudaytime = true;
}
````

Exchange 

````javascript
    // These are the particular shades of red, yellow, green, and blue.
    let red = 'rgba(213,9,21,1)';
    let yellow = 'rgba(234,168,0,1)';
    let green = 'rgba(134,207,70,1)';
    let blue = 'rgba(78,143,207,1)';
````

with

````javascript
// These are the particular shades of red, yellow, green, and blue.
var red = 'rgba(213,9,21,1)';
var yellow = 'rgba(152,109,0,1)';
var green = 'rgba(65,134,5,1)';
var blue = 'rgba(78,143,207,1)';

if (!tfudaytime) {
    // Brighter colors for the night for better contrast
    blue = 'rgba(123,185,255,1)';
    yellow = 'rgba(255,208,88,1)';
}
````


Exchange `// Threshold background coloring.` part with

````javascript
 if (tfudaytime) {
// Daytime

    // Threshold background coloring.
    if (bgNum < bgLow) {
        $('body').css('background-color', red);
    }
    if ((bgLow <= bgNum) && (bgNum < bgTargetBottom)) {
        $('body').css('background-color', blue);
    }
    if ((bgTargetBottom <= bgNum) && (bgNum < bgTargetTop)) {
        $('body').css('background-color', green);
    }
    if ((bgTargetTop <= bgNum) && (bgNum < bgHigh)) {
        $('body').css('background-color', yellow);
    }
    if (bgNum >= bgHigh) {
        $('body').css('background-color', red);
    }
} else {
// Nighttime

    // Threshold background coloring.
    if (bgNum < bgLow) {
        $('body').css('background-color', red);
        $('body').css('color', 'white');
    }
    if ((bgLow <= bgNum) && (bgNum < bgTargetBottom)) {
        $('body').css('background-color', blue);
        $('body').css('color', 'white');
    }
    if ((bgTargetBottom <= bgNum) && (bgNum < bgTargetTop)) {
        $('body').css('background-color', 'black');
        $('body').css('color', green);
    }
    if ((bgTargetTop <= bgNum) && (bgNum < bgHigh)) {
        $('body').css('background-color', 'black');
        $('body').css('color', yellow);
    }
    if (bgNum >= bgHigh) {
        $('body').css('background-color', red);
        $('body').css('color', 'white');
    }
}
````

Replace

````javascript
$('body').css('color', bgColor ? 'white' : 'grey');
````

with

````javascript
if (tfudaytime) {
    $('body').css('color', bgColor ? 'white' : 'grey');
}
````

...\cgm-remote-monitor\views\clockviews\clock-shared.css

body add

````css
text-shadow: -1px -1px 0 #2a2a2a, 1px -1px 0 #2a2a2a, -1px 1px 0 #2a2a2a, 1px 1px 0 #2a2a2a;
````