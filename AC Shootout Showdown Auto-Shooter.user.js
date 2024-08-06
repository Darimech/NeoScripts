// ==UserScript==
// @name         AC Shootout Showdown Auto-Shooter
// @namespace    Darimech
// @version      2024-08-06
// @description  Automatically plays Shootout Showdown for the Neopets Altador Cup.
// @author       Darimech
// @match        https://www.neopets.com/altador/colosseum/ctp.phtml?game_id=1400*
// @icon         https://images.neopets.com/items/yooyu.gif
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

let isRunning = false;

const TEST_MODE_DONT_SEND_SCORE = false;
let DEBUG = false;

const MAX_PLAYS = 242;
const BUTTON_ID = "autoPlayButton";
const PIXEL_COLORS = {
  titleScreen: ["#fefefe"],
  playScreen: ["#3a3a3a"],
  scoreScreen: ["#3366cc"],
};

const GameState = {
  onTitleScreen: "title",
  playing: "play",
  onScoreScreen: "score",
};

main();

function main() {
  addUi();
}

function addUi() {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.classList = "button-default__2020 button-yellow__2020";
  button.style.marginTop = "16px";

  button.append(document.createElement("span"));
  button.append(" ");
  button.append(document.createElement("span"));

  document.querySelector(".altadorCupCTP-frame").append(button);
  setButtonText("Start Auto-Shooting");

  button.addEventListener("click", () => {
    if (isRunning) {
      stopAutoShooter();
      return;
    }

    runAutoShooter();
  });
}

function setButtonText(text, secondaryText = "") {
  const button = document.getElementById(BUTTON_ID);
  if (text) {
    button.querySelector("span").textContent = text;
  }

  button.querySelector("span:last-child").textContent = secondaryText;
  if (TEST_MODE_DONT_SEND_SCORE) {
    button.querySelector("span:last-child").textContent += " (Test Mode)";
  }
}

async function tick() {
  if (!isRunning) return;

  const actions = {
    async [GameState.onTitleScreen]() {
      await clickStartGameButton();
    },
    async [GameState.playing]() {
      // todo: Optionally use the arrow keys before pressing space to act like we try to aim the shot
      debug("Shooting");
      await pressSpaceKey();
    },
    async [GameState.onScoreScreen]() {
      await sendScore();
    },
    async unknownState() {},
  };

  const currentState = (await detectGameState()) ?? "unknownState";
  debug("Current state:", currentState);

  await (actions[currentState] ?? actions.unknownState)();

  debug("Finished action for state", currentState);
  debug("Waiting for next tick...");
  await sleepAbout(1000);
}

function detectFailedCaptcha() {
  const responseDisplay = document.getElementById("responseDisplay")?.innerText;

  if (!responseDisplay) {
    return false;
  }

  // OOPS!!! Failed Captcha validation.
  // Please refresh the page and try again!
  const failedCaptcha = responseDisplay
    .toLowerCase()
    .includes("failed captcha validation");

  if (!failedCaptcha) {
    return false;
  }

  log("Failed Captcha validation!");
  stopAutoShooter();
  setButtonText("Failed Captcha validation");
  document.getElementById(BUTTON_ID).disabled = true;
  alert(
    "Message from the AC Shootout Showdown Auto-Shooter script:\n\n" +
      "It looks like the captcha validation failed while submitting your score. Careful, I don't know if this can get your account flagged. \n\n" +
      "Do some actions around the site manually and make sure to occasionally move your mouse, click around, and refresh the page to avoid getting flagged for botting."
  );
  return true;
}

async function sendScore() {
  const isScoreSent = () =>
    document.getElementById("resultTitle").innerText.includes("Success") ||
    document.getElementById("resultTitle").innerText.includes("Failed");

  if (TEST_MODE_DONT_SEND_SCORE) {
    log("Skipping sending score in test mode");
    await clickRestartGameButton();
    while (await isScoreScreen()) {
      await sleep(1000);
    }
    return;
  }

  log("Time to send score");
  await clickSendScoreButton();

  let scoreSendTries = 5;
  do {
    if (scoreSendTries === 0) {
      log("Failed to send score (or it's taking too long)");
      stopAutoShooter();
      return;
    }
    debug("Waiting for score send success...");
    await sleep(2000);
    scoreSendTries -= 1;

    if (detectFailedCaptcha()) {
      return;
    }
  } while (!isScoreSent());

  const responseDisplay = document.getElementById("responseDisplay").innerText;

  const totalPlays = responseDisplay.match(/Plays Today: (\d+)/)[1];

  // might also see:
  // "No match today (practice/bye day)"
  const canKeepRanking =
    responseDisplay.includes("For Altador Cup you can keep ranking") ||
    /NP: \d+/i.test(responseDisplay);

  if (canKeepRanking) {
    log("Score sent! Total plays:", totalPlays);
    setButtonText(null, `(Games played: ${totalPlays})`);
  }
  const hasHitMaxPlays = parseInt(totalPlays) >= MAX_PLAYS;

  if (!canKeepRanking || hasHitMaxPlays) {
    stopAutoShooter();

    setButtonText(
      hasHitMaxPlays
        ? `Max plays reached: ${totalPlays}`
        : "Stopped: You can't rank anymore today"
    );

    document.getElementById(BUTTON_ID).disabled = true;
    return;
  }

  document.querySelector("#btnDismiss").click();
  await sleep(100);

  let remainingTries = 5;
  while (
    remainingTries > 0 &&
    document.querySelector("#resultPopup").checkVisibility()
  ) {
    remainignTries -= 1;
    if (remainignTries === 0) {
      log("Failed to dismiss popup");
      stopAutoShooter();
      return;
    }
    debug("Waiting for popup to dismiss...");
    await sleep(100);
  }

  debug("Popup closed");
}

async function runAutoShooter() {
  log("Starting...");
  isRunning = true;
  setButtonText("Stop Auto-Shooting");

  try {
    while (isRunning) {
      debug("tick");
      await tick();
      debug("tick finished");
    }
    debug("done running");
  } catch (e) {
    log("Encountered an error", e);
    stopAutoShooter();
  }
}

function stopAutoShooter() {
  log("Stopping...");
  isRunning = false;
  setButtonText("Start Auto-Shooting");
}

async function clickStartGameButton() {
  if (!(await isTitleScreen())) return;
  const startButtonPosition = new DOMRect(390, 520, 255, 75);
  log("Starting game");
  await simulateCanvasClick(getGameCanvas(), startButtonPosition);
}

async function clickSendScoreButton() {
  if (!(await isScoreScreen())) return;
  const sendScorePosition = new DOMRect(250, 530, 300, 65);
  log("Sending score");
  await simulateCanvasClick(getGameCanvas(), sendScorePosition);
}

async function clickRestartGameButton() {
  if (!(await isScoreScreen())) return;
  const sendScorePosition = new DOMRect(335, 460, 220, 45);
  log("Restarting game");
  await simulateCanvasClick(getGameCanvas(), sendScorePosition);
}


async function detectGameState(color) {
  const pixelColor = await getPixelColor(getGameCanvas());
  if (await isTitleScreen(pixelColor)) {
    return GameState.onTitleScreen;
  } else if (await isPlayScreen(pixelColor)) {
    return GameState.playing;
  } else if (await isScoreScreen(pixelColor)) {
    return GameState.onScoreScreen;
  }

  debug(
    "I don't recognize what screen this is (has the game loaded yet?)",
    pixelColor
  );

  return null;
}

async function isTitleScreen(color) {
  return PIXEL_COLORS.titleScreen.includes(
    color ?? (await getPixelColor(getGameCanvas()))
  );
}

async function isPlayScreen(color) {
  return PIXEL_COLORS.playScreen.includes(
    color ?? (await getPixelColor(getGameCanvas()))
  );
}

async function isScoreScreen(color) {
  return PIXEL_COLORS.scoreScreen.includes(
    color ?? (await getPixelColor(getGameCanvas()))
  );
}

function pressSpaceKey() {
  return simulateKeyPress(getGameCanvas(), {
    key: " ",
    code: "Space",
    keyCode: 32,
    charCode: 32,
    which: 32,
    bubbles: true,
  });
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

/**
 * Presses and releases a key with a delay.
 * @param {HTMLElement} targetElement The element to simulate the event on.
 * @param {KeyboardEventInit} eventInit The event to simulate.
 */
async function simulateKeyPress(
  targetElement,
  eventInit,
  approximatePressTime = 1000
) {
  targetElement.dispatchEvent(new KeyboardEvent("keydown", eventInit));

  await sleepAbout(approximatePressTime);

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
  // accounts for scaling if the game is fullscreen or scaled otherwise
  const clientX = (targetElement.clientWidth / targetElement.width) * x;
  const clientY = (targetElement.clientHeight / targetElement.height) * y;

  var rect = targetElement.getBoundingClientRect();
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
          x: mouseDownPosition.x + gaussianRandom(-10, 10),
          y: mouseDownPosition.y + gaussianRandom(-10, 10),
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

  await sleepAbout(clickDuration);

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

/**
 * Generates a random number between min and max using a gaussian distribution.
 * @param {number} min The minimum value to generate (inclusive).
 * @param {number} max The maximum value to generate (inclusive).
 * @param {number?} passes The number of random numbers to generate and average.
 * @returns {number} A random number between min and max (inclusive).
 */
function gaussianRandom(min, max, passes = 6) {
  let total = 0;
  for (let i = 0; i < passes; i++) {
    total += Math.random();
  }
  return Math.floor(min + (total / passes) * (max - min) + 0.5);
}

/**
 * @param {Rect} bounds
 * @returns {Point}
 */
function randomPosition(bounds) {
  return {
    x: gaussianRandom(bounds.x, bounds.x + bounds.width),
    y: gaussianRandom(bounds.y, bounds.y + bounds.height),
  };
}

/**
 * Generates a random number around a given amount.
 * @param {number} amount The amount to generate around.
 * @param {number} percentRange The percentage range to generate around the amount, e.g. 0.5 for a range of 50% above or below the amount.
 * @returns {number} A random number around the given amount.
 */
function about(amount, percentRange = 0.5) {
  return gaussianRandom(
    amount * (1 - percentRange),
    amount * (1 + percentRange)
  );
}

/**
 * @param {number} ms How long to sleep in milliseconds.
 * @returns A promise that resolves after the given time.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sleeps for a random amount of time approximately about the given amount.
 * @param {number} ms How long to sleep in milliseconds.
 * @returns A promise that resolves after the given time.
 */
function sleepAbout(ms) {
  return sleep(about(ms));
}

function log(...messages) {
  console.log(...messages);
}

function debug(...messages) {
  if (DEBUG) console.debug(`DEBUG ${new Date().toISOString()}:`, ...messages);
}

unsafeWindow.AC_SOSD_enableDebug = () => (DEBUG = true);
unsafeWindow.AC_SOSD_disableDebug = () => (DEBUG = false);
