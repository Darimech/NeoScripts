// ==UserScript==
// @name         AC Make Some Noise Automasher
// @namespace    Darimech
// @version      2024-08-20
// @description  Automatically mashes keys in the Make Some Noise game in the Altador Cup on Neopets.
// @author       Darimech
// @match        https://www.neopets.com/altador/colosseum/ctp.phtml?game_id=1399*
// @icon         https://bookofages.jellyneo.net/assets/imgs/characters/lg/132.png
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

let DEBUG = false;
let DELAY = 30;

main();

function main() {
  const masher = makeKeyMasher();

  const input = document.createElement("input");
  input.type = "text";
  const button = document.createElement("button");
  button.textContent = "Start Mashing";

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      button.click();
    }
  });

  input.addEventListener("input", () => {
    input.value = input.value.slice(-2);
  });

  button.addEventListener("click", () => {
    if (masher.isRunning()) {
      masher.stop();
      return;
    }
    const letters = input.value;
    if (letters.length === 0) {
      alert("Please enter some letters to mash.");
      return;
    }
    masher.start(letters).then((timesPressed) => {
      debug(`Pressed keys ${timesPressed} times.`);
      button.textContent = "Start Mashing";
    });
    button.textContent = "Stop Mashing";
  });

  const container = document.createElement("div");
  container.style.padding = "10px";

  container.append(input, " ", button);
  container.append(document.createElement("br"));
  container.append(document.createElement("br"));
  container.append(
    "Hold shift while typing the keys before pressing 'start mashing' (or pressing enter)"
  );
  container.append(document.createElement("br"));
  container.append(document.createElement("br"));

  const delayInput = document.createElement("input");
  delayInput.type = "number";
  delayInput.value = DELAY;
  delayInput.addEventListener("change", () => {
    DELAY = Number(delayInput.value);
  });
  container.append(" Delay (ms): ", delayInput);

  document.querySelector(".altadorCupCTP-frame").append(container);
}

function makeKeyMasher() {
  let isRunning = false;
  let lastScoreScreenCheckAt = Date.now();

  return Object.freeze({
    /**
     * @param {string} letters
     */
    start: async (letters) => {
      debug("Starting masher with letters:", letters);
      let currentIndex = 0;
      isRunning = true;

      const letterEvents = letters.split("").map(getLetterEvent);

      while (isRunning) {
        if (await isScoreScreen()) {
          debug("Score screen detected, stopping masher.");
          await sendScore();
          break;
        }
        await simulateKeyPress(
          document,
          letterEvents[currentIndex % letters.length]
        );
        await sleep(DELAY);
        currentIndex += 1;
      }
      isRunning = false;
      return currentIndex;
    },
    checkScoreScreen: async () => {
      if (Date.now() - lastScoreScreenCheckAt < 1000) return false;
      lastScoreScreenCheckAt = Date.now();
      return isScoreScreen();
    },
    stop: () => {
      debug("Stopping masher.");
      isRunning = false;
    },
    isRunning: () => isRunning,
  });
}

async function sendScore() {
  const isScoreSent = () =>
    document.getElementById("resultTitle").innerText.includes("Success");

  const isScoreError = () =>
    document.getElementById("resultTitle").innerText.includes("Error");

  await clickSendScoreButton();

  while (!isScoreSent()) {
    await sleep(100);
    if (isScoreError()) {
      debug("Error sending score");
      return;
    }
  }

  document.querySelector("#btnDismiss").click();

  await sleep(100);
  await clickStartGameButton();
}

async function clickStartGameButton() {
  const startGamePosition = new DOMRect(7, 500, 200, 80);
  debug("Clicking send score button.");
  await simulateCanvasClick(getGameCanvas(), startGamePosition);
}

async function clickSendScoreButton() {
  const sendScorePosition = new DOMRect(376, 380, 200, 80);
  debug("Clicking send score button.");
  await simulateCanvasClick(getGameCanvas(), sendScorePosition);
}

async function isScoreScreen() {
  const pixel = await getPixelColor(getGameCanvas());
  return pixel === "#cfcfcf";
}

/// Game canvas ///

/**
 * @returns {HTMLCanvasElement} The altador cup game canvas element.
 */
function getGameCanvas() {
  return document.querySelector(".altadorCupCTP-Game canvas");
}

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ x: number, y: number }} Point
 *
 * Reads the image data from the game canvas.
 * @param {Rect | Point} rect A rectangle or point indicating the area to read the pixel(s) from.
 * @returns
 */
function readPixelsInRect(canvas, { x, y, width = 1, height = 1 }) {
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");

  const pixels = new Uint8Array(width * height * 4);

  // invert the y axis because the GL axis is flipped compared to how we deal with coordinates in web
  const invertedY = gl.drawingBufferHeight - y - height;

  // console.debug("Reading pixels at", x, invertedY, width, height);

  return new Promise((resolve) =>
    requestAnimationFrame(() => {
      gl.readPixels(
        x,
        invertedY,
        width,
        height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels
      );
      resolve(pixels);
    })
  );
}

async function getPixelColor(canvas, point = { x: 0, y: 0 }) {
  const pixel = await readPixelsInRect(canvas, point);

  const r = pixel[0].toString(16).padStart(2, "0");
  const g = pixel[1].toString(16).padStart(2, "0");
  const b = pixel[2].toString(16).padStart(2, "0");

  return `#${r}${g}${b}`;
}

/// Event simulation ///

function getLetterEvent(letter) {
  letter = letter.toUpperCase();
  const charCode = letter.charCodeAt(0);
  return {
    key: letter,
    code: `Key${letter}`,
    keyCode: charCode,
    which: charCode,
    bubbles: true,
  };
}

/**
 * Presses and releases a key with a delay.
 * @param {HTMLElement} targetElement The element to simulate the event on.
 * @param {KeyboardEventInit} eventInit The event to simulate.
 */
async function simulateKeyPress(targetElement, eventInit) {
  targetElement.dispatchEvent(new KeyboardEvent("keydown", eventInit));

  await sleep(DELAY);

  targetElement.dispatchEvent(new KeyboardEvent("keyup", eventInit));
}

/**
 * Simulates a mouse event.
 * @param {HTMLElement} targetElement The element to simulate the event on.
 * @param {"mousedown" | "mouseup"} type The type of event to simulate.
 * @param {number} x The x position to simulate the event at.
 * @param {number} y The y position to simulate the event at.
 */
function simulateMouseEvent(targetElement, type, x, y) {
  var rect = targetElement.getBoundingClientRect();
  // accounts for scaling if the game is fullscreen or scaled otherwise
  const clientX = (rect.width / targetElement.width) * x;
  const clientY = (rect.height / targetElement.height) * y;

  var event = new MouseEvent(type, {
    clientX: rect.left + clientX,
    clientY: rect.top + clientY,
    bubbles: true,
    cancelable: true,
    view: unsafeWindow,
  });
  targetElement.dispatchEvent(event);
}

/**
 * Simulates a click on a target element at a random position within the bounds.
 * This attempts to simulate a more human-like click by moving the mouse around a bit sometimes and clicking only approximately in the middle of the click bounds.
 * @param {HTMLElement} targetElement The element to click on.
 * @param {Rect} clickBounds The bounds to click within.
 */
async function simulateCanvasClick(targetElement, clickBounds) {
  const mouseDownPosition = randomPosition(clickBounds);

  const isStable = Math.random() < 0.8;
  const mouseUpPosition = isStable
    ? mouseDownPosition
    : keepInBounds(
        {
          x: mouseDownPosition.x + random(-10, 10),
          y: mouseDownPosition.y + random(-10, 10),
        },
        clickBounds
      );

  const clickDuration = Math.random() < 0.2 ? 300 : 100;

  simulateMouseEvent(
    targetElement,
    "mousedown",
    mouseDownPosition.x,
    mouseDownPosition.y
  );

  await sleep(clickDuration);

  simulateMouseEvent(
    targetElement,
    "mouseup",
    mouseUpPosition.x,
    mouseUpPosition.y
  );
}

/// Utility functions ///

/**
 * @param {Point} point
 * @param {Rect} bounds
 * @returns
 */
function keepInBounds(point, bounds) {
  return {
    x: Math.min(Math.max(point.x, bounds.x), bounds.x + bounds.width),
    y: Math.min(Math.max(point.y, bounds.y), bounds.y + bounds.height),
  };
}

function random(min, max) {
  let total = Math.random();
  return Math.floor(min + total * (max - min));
}

/**
 * @param {Rect} bounds
 * @returns {Point}
 */
function randomPosition(bounds) {
  return {
    x: random(bounds.x, bounds.x + bounds.width),
    y: random(bounds.y, bounds.y + bounds.height),
  };
}

/**
 * @param {number} ms How long to sleep in milliseconds.
 * @returns A promise that resolves after the given time.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debug(...messages) {
  if (DEBUG) console.debug(`DEBUG ${new Date().toISOString()}:`, ...messages);
}

unsafeWindow.AC_MSN_enableDebug = () => (DEBUG = true);
unsafeWindow.AC_MSN_disableDebug = () => (DEBUG = false);
