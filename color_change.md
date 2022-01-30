...\cgm-remote-monitor\lib\client\clock-client.js

````javascript
    // These are the particular shades of red, yellow, green, and blue.
    let red = 'rgba(213,9,21,1)';
    let yellow = 'rgba(234,168,0,1)';
    let green = 'rgba(134,207,70,1)';
    let blue = 'rgba(78,143,207,1)';
````

green -> rgba(65,134,5,1)
yellow -> rgba(152,109,0,1))

Before `// Color Background add`

````javascript
// Get current time
var tfudt = new Date();
var tfutime = tfudt.getHours();
````

Exchange `// Threshold background coloring.` part with

````javascript
 // Daytime
    if (tfutime >= 8 && tfutime <= 21) {
      
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
      // Threshold background coloring.

      $('body').css('background-color', 'black');

      if (bgNum < bgLow) {
        $('body').css('color', red);
      }
      if ((bgLow <= bgNum) && (bgNum < bgTargetBottom)) {
        $('body').css('color', blue);
      }
      if ((bgTargetBottom <= bgNum) && (bgNum < bgTargetTop)) {
        $('body').css('color', green);
      }
      if ((bgTargetTop <= bgNum) && (bgNum < bgHigh)) {
        $('body').css('color', yellow);
      }
      if (bgNum >= bgHigh) {
        $('body').css('color', red);
      }
    }
````

...\cgm-remote-monitor\views\clockviews\clock-shared.css

body add

````css
text-shadow: -1px -1px 0 #2a2a2a, 1px -1px 0 #2a2a2a, -1px 1px 0 #2a2a2a, 1px 1px 0 #2a2a2a;
````