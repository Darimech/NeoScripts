// ==UserScript==
// @name         Kadoatery Monitor
// @namespace    Darimech
// @version      2024-08-10
// @description  Monitors for Kadoatery restocks and checks prices for items in the SSW for you to feed them faster! (Requires premium for SSW access)
// @author       Darimech
// @match        https://www.neopets.com/games/kadoatery/*
// @icon         https://images.neopets.com/games/kadoatery/white_sad.gif
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

(function () {
    "use strict";
  
    const SEND_CONSOLE_LOGS = false;
  
    let isRunning = GM_getValue("isRunning", false);
    let lastRestockTime = GM_getValue("lastRestock", 0);
    let lastRestockKads = JSON.parse(GM_getValue("lastRestockKads", "[]"));
    let lastUnfedKads = JSON.parse(GM_getValue("unfedKads", "[]"));
    let lastLogTimestamp = null;
  
    const sswQueue = {
      promises: [],
      isBusy: false,
      waitForTurn({ skipQueue = false } = {}) {
        const shouldWait = this.isBusy || this.promises.length > 0;
        this.isBusy = true;
        return shouldWait
          ? new Promise((resolve) => {
              if (skipQueue) {
                this.promises.unshift(resolve);
              } else {
                this.promises.push(resolve);
              }
            })
          : Promise.resolve();
      },
      markFinished() {
        const resolve = this.promises.shift();
        if (resolve) {
          resolve();
        } else {
          this.isBusy = false;
        }
      },
      async act(callback, options) {
        await this.waitForTurn(options);
        return Promise.resolve(callback()).finally(() => {
          this.markFinished();
        });
      },
    };
  
    const Log = {
      entries: JSON.parse(GM_getValue("logs", "[]")),
      persistLogs: GM_getValue("persistLogs", false),
      setPersistLogs(value) {
        this.persistLogs = value;
        GM_setValue("persistLogs", value);
        if (!value) {
          GM_setValue("logs", "[]");
        }
      },
      push(entry) {
        this.entries.push(entry);
        if (this.entries.length > 100) {
          this.entries.shift();
        }
        if (this.persistLogs) {
          GM_setValue("logs", JSON.stringify(this.entries));
        }
        updateKadLogs();
      },
      reset() {
        this.entries = [];
        GM_setValue("logs", "[]");
        updateKadLogs();
      },
    };
    main();
  
    function main() {
      addUi();
  
      const isMainPage =
        window.location.pathname === "/games/kadoatery/index.phtml" ||
        window.location.pathname === "/games/kadoatery/";
      if (isMainPage) {
        checkKads();
      }
    }
  
    function addUi() {
      const container = document.createElement("div");
  
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.alignItems = "center";
      container.style.gap = "16px";
      container.style.marginBottom = "32px";
  
      container.append(makeStartButton());
      container.append(makeTimeRestockedInput());
      container.append(makeEnableNotificationsCheckbox());
  
      const options = document.createElement("div");
  
      options.style.marginTop = "8px";
      options.style.display = "flex";
      options.style.flexDirection = "column";
      options.style.gap = "8px";
      options.style.alignItems = "center";
      options.style.border = "1px solid #ccc";
      options.style.padding = "8px";
      options.style.width = "300px";
  
      options.append(makeButton("Reset kads seen", () => setKadsRestocked([])));
  
      appendLogsUi(container);
      container.append(makeCollapsibleDetails("More options", options));
  
      document.querySelector(".content table").before(container);
    }
  
    function makeCollapsibleDetails(title, body, onToggle) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = title;
      summary.style.cursor = "pointer";
  
      details.append(summary);
      if (Array.isArray(body)) {
        body.forEach((element) => details.append(element));
      } else {
        details.append(body);
      }
  
      if (onToggle) {
        details.addEventListener("toggle", () => {
          onToggle(details.open);
        });
      }
  
      return details;
    }
  
    function appendLogsUi(parent) {
      const logScroller = document.createElement("div");
      logScroller.classList = "log-scroller";
      logScroller.style.maxHeight = "200px";
      logScroller.style.overflow = "auto";
      logScroller.style.border = "1px solid #ccc";
      logScroller.style.width = "100%";
      logScroller.style.backgroundColor = "#f9f9f9";
      logScroller.style.marginTop = "8px";
  
      const logMessages = document.createElement("div");
      logMessages.classList = "log-messages";
  
      logMessages.style.overflowAnchor = "none";
      logMessages.style.whiteSpace = "pre";
      logMessages.style.padding = "8px";
      logMessages.style.textAlign = "left";
      logMessages.style.fontFamily = "courier, monospace";
      logMessages.style.fontSize = "14px";
      logMessages.style.fontWeight = "600";
      logMessages.style.boxSizing = "border-box";
  
      logScroller.append(logMessages);
  
      const overflowAnchor = document.createElement("div");
      overflowAnchor.style.overflowAnchor = "auto";
      overflowAnchor.style.width = "100%";
      overflowAnchor.style.height = "1px";
      overflowAnchor.className = "overflow-anchor";
      logScroller.append(overflowAnchor);
  
      const options = document.createElement("div");
      options.style.display = "flex";
      options.style.gap = "8px";
  
      options.append(makeButton("Clear logs", () => Log.reset()));
      options.append(
        makeCheckbox("Persist logs", Log.persistLogs, (e) => {
          Log.setPersistLogs(e.target.checked);
        })
      );
  
      const details = makeCollapsibleDetails(
        "Logs",
        [options, logScroller],
        (opened) => {
          updateKadLogs();
          GM_setValue("logsOpen", opened);
          if (opened) {
            logScroller.scrollTop = logScroller.scrollHeight;
          }
        }
      );
  
      details.id = "kads-logs";
      details.open = GM_getValue("logsOpen", false);
      details.style.width = "100%";
  
      parent.append(details);
    }
  
    function updateKadLogs() {
      if (!document.querySelector("#kads-logs").open) return;
  
      const logContainer = document.querySelector("#kads-logs .log-messages");
      const messages = [];
  
      let prevTimestamp = null;
      for (const entry of Log.entries) {
        const timestampDisplay = getLogTimestampDisplay(
          new Date(entry.timestamp),
          prevTimestamp && new Date(prevTimestamp)
        );
        if (timestampDisplay) {
          messages.push(timestampDisplay);
        }
        messages.push(" ".repeat(4) + entry.messages.join(" "));
        prevTimestamp = entry.timestamp;
      }
  
      logContainer.textContent = messages.join("\n") || "The log is empty";
    }
  
    function makeStartButton() {
      const button = document.createElement("button");
      button.id = "kads-start-stop";
      button.textContent = isRunning ? "Stop" : "Start";
  
      button.addEventListener("click", async () => {
        setIsRunning(!isRunning);
  
        if (isRunning) {
          log("Starting pricing and restock check");
          checkKads();
        } else {
          log("Stopping pricing and restock check");
        }
      });
      return button;
    }
  
    function makeButton(text, onClick) {
      const button = document.createElement("button");
      button.textContent = text;
      button.addEventListener("click", onClick);
      return button;
    }
  
    function makeCheckbox(label, checked, onChange) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = checked;
      if (onChange) {
        input.addEventListener("change", onChange);
      }
      const labelElement = document.createElement("label");
      labelElement.textContent = label;
      labelElement.style.display = "flex";
      labelElement.style.alignItems = "center";
      labelElement.style.gap = "8px";
      labelElement.append(input);
  
      labelElement.getInput = () => input;
  
      return labelElement;
    }
  
    function makeEnableNotificationsCheckbox() {
      const label = makeCheckbox(
        "Enable notifications",
        GM_getValue("enableNotifications", false) &&
          Notification.permission === "granted",
        async (e) => {
          const input = e.target;
          GM_setValue("enableNotifications", input.checked);
  
          if (!input.checked) return;
          let isGranted = Notification.permission === "granted";
          if (!isGranted) {
            isGranted = await new Promise((resolve) =>
              Notification.requestPermission().then((permission) => {
                resolve(permission === "granted");
              })
            );
          }
  
          input.checked = isGranted;
  
          if (isGranted) {
            new Notification("Neopets - The Kadoatery", {
              body: "Notifications enabled!",
            });
          } else {
            alert("Notification permission is required to enable notifications");
          }
        }
      );
  
      label.getInput().id = "kads-enable-notifications";
  
      return label;
    }
  
    function sendNotification(message) {
      if (!GM_getValue("enableNotifications", false)) {
        return;
      }
  
      if (Notification.permission === "granted") {
        new Notification("Neopets - The Kadoatery", {
          body: message,
        });
      }
    }
  
    function makeTimeRestockedInput() {
      const input = document.createElement("input");
      input.type = "time";
      input.id = "kads-time-restocked";
  
      input.addEventListener("change", () => {
        const time = new Date();
        const [hours, minutes] = input.value.split(":");
        time.setHours(hours);
        time.setMinutes(minutes);
        if (time > Date.now()) {
          time.setDate(time.getDate() - 1);
        }
        updateLastRestockTime(time);
  
        updateTimeInput(input, time);
      });
  
      const label = document.createElement("label");
      label.textContent = "Last major restock seen at:";
      label.style.display = "flex";
      label.style.alignItems = "center";
      label.style.gap = "8px";
      label.append(input);
      label.append(document.createElement("span"));
  
      updateTimeInput(input, new Date(lastRestockTime));
  
      return label;
    }
  
    function setIsRunning(value) {
      isRunning = value;
      GM_setValue("isRunning", value);
      document.querySelector("#kads-start-stop").textContent = value
        ? "Stop"
        : "Start";
    }
  
    function getNewKads(newKads, oldKads) {
      return newKads.filter((name) => !oldKads.includes(name));
    }
  
    function setKadsRestocked(kadNames) {
      lastRestockKads = kadNames;
      GM_setValue("lastRestockKads", JSON.stringify(kadNames));
  
      const time = new Date();
      updateLastRestockTime(time);
      updateTimeInput(document.querySelector("#kads-time-restocked"), time);
    }
  
    function setUnfedKads(kadNames) {
      lastUnfedKads = kadNames;
      GM_setValue("unfedKads", JSON.stringify(kadNames));
    }
  
    /**
     * @param {Date} date
     */
    function updateLastRestockTime(date) {
      lastRestockTime = date.getTime();
      GM_setValue("lastRestock", lastRestockTime);
    }
  
    /**
     * @param {Date} date
     * @param {HTMLInputElement} input
     */
    function updateTimeInput(input, date) {
      input.value = date.toTimeString().split(" ")[0];
  
      const dateDiff = new Date().getDate() - date.getDate();
  
      input.nextElementSibling.textContent =
        dateDiff === 1
          ? "(yesterday)"
          : dateDiff !== 0
          ? `(${date.toLocaleDateString()})`
          : "";
    }
  
    async function checkKads() {
      const allKads = [...document.querySelectorAll(".content table td")];
      const unfedKads = allKads.filter(
        (td) => !td.textContent.includes("has been fed")
      );
  
      const allKadNames = allKads.map(
        (td) => td.querySelector("strong").textContent
      );
      const unfedKadNames = unfedKads.map(
        (td) => td.querySelector("strong").textContent
      );
  
      const newKads = getNewKads(allKadNames, lastRestockKads);
      const newUnfedKads = getNewKads(unfedKadNames, lastUnfedKads);
      const username = document.querySelector(".user a").textContent;
      const userHasFed = allKads.find((td) =>
        td.textContent.includes(`Thanks, ${username}`)
      );
  
      if (newKads.length) {
        log("New major restock detected, setting last restock time");
        setKadsRestocked(allKadNames);
      }
  
      if (unfedKads.length) {
        if (!userHasFed && newUnfedKads.length) {
          sendNotification(
            newUnfedKads.length === 1
              ? "One Kadoatie needs feeding"
              : `${newUnfedKads.length} Kadoaties need feeding`
          );
        }
  
        setUnfedKads(unfedKadNames);
  
        await checkPrices(shuffle(unfedKads), { cacheOnly: !isRunning });
      } else {
        const lastRestockDate = new Date(lastRestockTime);
        let timeDisplay = lastRestockDate.toLocaleTimeString();
  
        if (
          lastRestockDate.toLocaleDateString() !== new Date().toLocaleDateString()
        ) {
          timeDisplay += " on " + lastRestockDate.toLocaleDateString();
        }
  
        log(
          "All Kadoaties are currently fed. Last restock was seen at " +
            timeDisplay
        );
      }
  
      const nextEstRestockTime = lastRestockTime + 1000 * 60 * 28;
      let timeUntilNextRestock = nextEstRestockTime - Date.now();
  
      log(
        timeUntilNextRestock < 0
          ? "Next restock was previously estimated at"
          : "Next restock estimated at",
        new Date(nextEstRestockTime).toLocaleTimeString()
      );
  
      if (timeUntilNextRestock < 1000 * 60 * -2) {
        while (timeUntilNextRestock < 1000 * 60 * 5) {
          timeUntilNextRestock += 1000 * 60 * 7;
        }
        log(
          "Restock appears to have been pushed back. New estimated time is",
          new Date(Date.now() + timeUntilNextRestock).toLocaleTimeString()
        );
      }
  
      if (!isRunning) return;
  
      const reloadIn = Math.max(
        gaussianRandom(timeUntilNextRestock / 3, timeUntilNextRestock / 2),
        gaussianRandom(1000, 2000) * 30 // 30-60 seconds minimum
      );
  
      log("Check again at", new Date(Date.now() + reloadIn).toLocaleTimeString());
  
      setTimeout(() => {
        if (isRunning) {
          log("Refreshing");
          unsafeWindow.location.reload();
        }
      }, reloadIn);
    }
  
    function makeDiv(text, color) {
      const div = document.createElement("div");
      div.textContent = text;
      if (color) {
        div.style.color = color;
      }
      return div;
    }
  
    function checkPriceAndUpdateDisplay(td, itemName, options) {
      td.querySelectorAll("div").forEach((div) => div.remove());
      td.append(makeDiv("Checking price...", "gray"));
  
      return checkPrice(itemName, options)
        .then(({ lowPrice, averagePrice, isUnbuyable, isUnknownPrice }) => {
          td.querySelectorAll("div").forEach((div) => div.remove());
          if (isUnknownPrice) {
            td.append(makeDiv("Price unknown", "gray"));
            return false;
          }
          if (isUnbuyable) {
            td.append(makeDiv("Item is unbuyable", "red"));
            return false;
          }
          td.append(
            makeDiv("Lowest price: " + lowPrice.toLocaleString() + " NP")
          );
          td.append(
            makeDiv("Average price: " + averagePrice.toLocaleString() + " NP")
          );
  
          return true;
        })
        .catch(() => {
          td.querySelectorAll("div").forEach((div) => div.remove());
          td.append(makeDiv("Error checking price", "red"));
  
          return false;
        });
    }
  
    function checkPrices(unfedKads, options) {
      if (!document.querySelector("#sswmenu")) {
        log("Unable to search for prices, SSW not found. Do you have premium?");
        return;
      }
  
      for (const td of unfedKads) {
        if (td.querySelector("button")) continue;
        const itemName = td.querySelector("br + strong").textContent.trim();
  
        const buyButton = makeButton("Buy", () => openCheapestShop(itemName));
        td.append(document.createElement("br"));
        td.append(buyButton);
        td.append(" ");
        td.append(
          makeButton("Re-check", () => {
            checkPriceAndUpdateDisplay(td, itemName, {
              updateCache: true,
              skipQueue: true,
            }).then((canBuy) => {
              buyButton.style.display = canBuy ? "" : "none";
            });
          })
        );
  
        checkPriceAndUpdateDisplay(td, itemName, options).then((canBuy) => {
          buyButton.style.display = canBuy ? "" : "none";
        });
      }
    }
  
    async function checkPrice(
      itemName,
      {
        buyIfCheap = false,
        updateCache = false,
        cacheOnly = false,
        skipQueue = false,
      } = {}
    ) {
      if (cacheOnly && updateCache) {
        throw new Error("Can't update cache when only using cache");
      }
      if (updateCache) {
        GM_setValue(`price[${itemName}]`, "null");
        log("Cleared cached price data for", itemName);
      }
      const price = JSON.parse(GM_getValue(`price[${itemName}]`, "null"));
      if (price && !updateCache) {
        if (buyIfCheap && price.lowPrice && price.lowPrice < 1000) {
          log("Price for", itemName, "is cheap, opening shop to buy");
          await openCheapestShop(itemName);
        }
  
        log("Loaded cached price for", itemName);
        return price;
      }
  
      if (cacheOnly) {
        log("No cached price found for", itemName);
        return { isUnknownPrice: true };
      }
  
      return checkItemPriceSsw(itemName, { buyIfCheap, skipQueue })
        .then((prices) => {
          log(
            "Lowest price for",
            itemName,
            "is",
            prices.lowPrice.toLocaleString(),
            "NP on the SSW"
          );
          GM_setValue(`price[${itemName}]`, JSON.stringify(prices));
          return prices;
        })
        .catch((error) => {
          if (error.textContent === "No items found.") {
            log("Item", itemName, "is unbuyable");
            const result = { isUnbuyable: true };
            GM_setValue(`price[${itemName}]`, JSON.stringify(result));
            return result;
          }
  
          const errorMessage =
            error.textContent ?? error.message ?? error.toString();
          log("Error checking price for", itemName, ":", errorMessage);
          throw e;
        });
    }
  
    async function checkItemPriceSsw(
      itemName,
      { buyIfCheap = false, skipQueue = false } = {}
    ) {
      log("Checking price for", itemName);
      const table = await getSswResults(itemName, { skipQueue });
  
      const rows = table.querySelectorAll("tr");
  
      let totalQuantity = 0;
      let totalPrice = 0;
      let lowPrice = null;
  
      rows.forEach((row, index) => {
        if (index === 0) return;
        const qty = parseInt(
          row.querySelector("td:nth-child(2)").textContent.replace(",", "").trim()
        );
        const price = parseInt(
          row
            .querySelector("td:nth-child(3)")
            .textContent.replace(" NP", "")
            .replace(",", "")
            .trim()
        );
  
        totalQuantity += qty;
        totalPrice += qty * price;
  
        if (lowPrice === null || price < lowPrice) {
          lowPrice = price;
        }
      });
  
      const averagePrice = Math.round(totalPrice / totalQuantity);
  
      if (buyIfCheap && lowPrice < 1000) {
        table.querySelector("a").click();
      }
  
      return {
        lowPrice,
        averagePrice,
      };
    }
  
    async function openCheapestShop(itemName) {
      const table = await getSswResults(itemName).catch((error) => {
        log("Couldn't open shop:", error.textContent ?? error.message);
      });
      table?.querySelector("a").click();
    }
  
    function getSswResults(
      searchTerm,
      { skipQueue = false, criteria = "exact" } = {}
    ) {
      return sswQueue.act(
        () => {
          const ssw = document.querySelector("#sswmenu");
  
          if (!ssw.querySelector(".sswdrop")?.checkVisibility()) {
            ssw.querySelector(".imgmenu").click();
          }
          ssw.querySelector("#searchstr").value = searchTerm;
          ssw.querySelector("#ssw-criteria").value = criteria;
          ssw.querySelector("#button-search").click();
  
          return new Promise((resolve, reject) => {
            const observer = new MutationObserver(() => {
              const errorResult = document.querySelector("#ssw_error_result");
              const results = document.querySelector("#results_table");
              if (results) {
                observer.disconnect();
                resolve(results);
              }
              if (errorResult) {
                observer.disconnect();
                reject(errorResult);
              }
            });
  
            observer.observe(document.querySelector("#results"), {
              childList: true,
              subtree: true,
            });
          });
        },
        { skipQueue }
      );
    }
  
    function gaussianRandom(min, max, n = 6) {
      let sum = 0;
      for (let i = 0; i < n; ++i) {
        sum += Math.random();
      }
      return min + (max - min) * (sum / n);
    }
  
    function shuffle(array) {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }
  
    function getLogTimestampDisplay(current, last) {
      if (current.toLocaleString() === last?.toLocaleString()) return "";
  
      return current.toLocaleDateString() === last?.toLocaleDateString()
        ? current.toLocaleTimeString()
        : `${current.toLocaleTimeString()} - ${current.toLocaleDateString()}`;
    }
  
    function log(...messages) {
      const logTimestamp = new Date();
      if (logTimestamp.toLocaleString() !== lastLogTimestamp?.toLocaleString()) {
        consoleLog(getLogTimestampDisplay(logTimestamp, lastLogTimestamp));
        lastLogTimestamp = logTimestamp;
      }
      consoleLog(" ".repeat(4), ...messages);
      Log.push({
        timestamp: logTimestamp.getTime(),
        messages,
      });
    }
  
    function consoleLog(...messages) {
      if (SEND_CONSOLE_LOGS) {
        console.log(...messages);
      }
    }
  })();
  