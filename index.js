const mineflayer = require("mineflayer");
const { mineflayer: mineflayerViewer } = require("prismarine-viewer");
const fetch = require("node-fetch");
require("dotenv").config();

let reconnectAttempts = 0;

function createBot() {
  const options = {
    host: process.env.SERVER,
    port: 25565,
    username: process.env.BOT_USERNAME,
    auth: "microsoft",
  };

  const bot = mineflayer.createBot(options);

  let balanceFullNotified = false;

  bot.once("spawn", () => {
    mineflayerViewer(bot, { port: 8888, firstPerson: true });

    const interval = (process.env.AMS_INTERVAL ? parseInt(process.env.AMS_INTERVAL) : 5) * 60000;

    setInterval( async () => {
      if(process.env.AMS_ACCESS_MODE === "command") { 
        bot.chat("/ams");
      } else {
        const targetBlock = bot.blockAtCursor();

        if (!targetBlock) {
          console.log("No target block in sight.");
          return;
        }

        if (bot.inventory.slots[bot.quickBarSlot + 36]) {
          const emptySlotIndex = bot.inventory.slots.slice(36, 45).findIndex(slot => !slot);
          if (emptySlotIndex !== -1) {
            bot.setQuickBarSlot(emptySlotIndex);
          } else {
            const emptyInventorySlotIndex = bot.inventory.slots.findIndex((slot, index) => !slot && index >= 9 && index < 36);
            if (emptyInventorySlotIndex !== -1) {
              await bot.moveSlotItem(bot.quickBarSlot + 36, emptyInventorySlotIndex);
            } else {
              await bot.tossStack(bot.inventory.slots[bot.quickBarSlot + 36]);
            }
          }
        }
        await bot.lookAt(targetBlock.position.offset(0.5, 0.5, 0.5), false);

        try {
          await bot.activateBlock(targetBlock);
        } catch (error) {
          console.error("Failed to activate block:", error);
        }
      }
    }, interval);
  });

  bot.on("windowOpen", (window) => {
    const goldIngotSlot = window.slots.findIndex(
      (item) => item && item.name === "gold_ingot",
    );

    if (goldIngotSlot !== -1) {
      const item = window.slots[goldIngotSlot];

      if (item.nbt && typeof item.nbt === "object") {
        try {
          const loreArray = item.nbt.value.display.value.Lore.value.value;

          loreArray.forEach((loreJsonString) => {
            try {
              const loreObject = JSON.parse(loreJsonString);
              if (loreObject.extra) {
                const balanceParts = loreObject.extra
                  .filter((part) => part.color === "gold")
                  .map((part) => part.text.trim());
                if (balanceParts.length > 0) {
                  const balance = balanceParts.join(" / ");
                  console.log("Balance fetched:", balance);
                  if (process.env.AMS_WEBHOOK_URL) {
                    let message = {
                      content: null,
                      embeds: [
                        {
                          description: balance,
                          color: 13938487,
                        },
                      ],
                      attachments: [],
                    };

                    if (balanceParts[0] === balanceParts[1]) {
                      if (!balanceFullNotified && process.env.DISCORD_USER_ID) {
                        message.content = `<@${process.env.DISCORD_USER_ID}>: Balance is full`;
                        balanceFullNotified = true;
                      }
                    } else {
                      balanceFullNotified = false;
                    }

                    fetch(process.env.AMS_WEBHOOK_URL, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify(message),
                    })
                      .then((response) => {
                        if (response.ok) {
                          console.log("AMS Webhook sent successfully");
                        } else {
                          console.log("AMS Webhook failed to send");
                        }
                      })
                      .catch((error) => {
                        console.error("Error sending webhook:", error);
                      });
                  }
                }
              }
            } catch (error) {
              console.error("Error parsing lore JSON string:", error);
            }
          });
        } catch (error) {
          console.error("Failed to access NBT data:", error);
        }
        bot.closeWindow(window);
      } else {
        console.log("NBT data is not in the expected format for item:", item);
        bot.closeWindow(window);
      }
    } else {
      console.log("Gold ingot not found in the opened window.");
      bot.closeWindow(window);
    }
  });

  bot.on("kicked", (reason, loggedIn) => console.log(reason, loggedIn));

  bot.on("end", () => {
    if (bot.viewer) {
      bot.viewer.close();
    }
    console.log("Disconnected, attempting to reconnect...");
    setTimeout(
      () => {
        reconnectAttempts++;
        createBot();
      },
      Math.min(10000 * reconnectAttempts, 60000),
    );
  });

  bot.on("message", (message) => {
    console.log(message.toAnsi());
    plainTextMessage = message.toString();
    authString = `MSG ►► ${process.env.BOT_OWNER_USERNAME} » Mir: `;

    if (plainTextMessage.startsWith(authString)) {
      const content = plainTextMessage.substring(authString.length);

      if (content.startsWith("/drop")) {
        dropItems();
      } else if (content.startsWith("/get")) {
        if (content === "/get level") {
          bot.chat(
            `/ msg ${process.env.BOT_OWNER_USERNAME} ${bot.experience.level} `,
          );
        } else if (content === "/get xp") {
          bot.chat(
            `/ msg ${process.env.BOT_OWNER_USERNAME} ${bot.experience.points} `,
          );
        }
      } else {
        bot.chat(content);
      }
    }

    if (
      plainTextMessage.startsWith(
        `MONEY ►► ${process.env.BOT_OWNER_USERNAME} hat dir`,
      )
    ) {
      bot.chat("/pot max");
    }

    if (plainTextMessage.startsWith(`►► ${options.username} hat `)) {
      const balance = plainTextMessage.substring(
        `►► ${options.username} hat`.length,
        plainTextMessage.indexOf("$"),
      );
      const money = balance.replace(/\./g, "");
      bot.chat(
        `/ pay ${process.env.BOT_OWNER_USERNAME} ${Math.round(money * 0.88)} `,
      );
    }

    if (
      plainTextMessage.startsWith("MSG ►► ") &&
      plainTextMessage.includes(" » Mir: ") &&
      !plainTextMessage.startsWith(authString)
    ) {
      if (process.env.MSG_WEBHOOK_URL) {
        const username = plainTextMessage.substring(
          "MSG ►► ".length,
          plainTextMessage.indexOf(" » Mir: "),
        );
        const content = plainTextMessage.substring(
          plainTextMessage.indexOf(" » Mir: ") + " » Mir: ".length,
        );
        let message = {
          content: null,
          embeds: [
            {
              description:
                username +
                " schrieb per MSG an " +
                options.username +
                ": " +
                content,
              color: 8375321,
            },
          ],
          attachments: [],
        };

        fetch(process.env.MSG_WEBHOOK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        })
          .then((response) => {
            if (response.ok) {
              console.log("MSG Webhook sent successfully");
            } else {
              console.log("MSG Webhook failed to send");
            }
          })
          .catch((error) => {
            console.error("Error sending webhook:", error);
          });
      }
    }

    if (
      plainTextMessage.startsWith(
        "BOOSTER ►► Es wurde ein globaler HasteBooster",
      ) &&
      process.env.HASTE_WEBHOOK_URL
    ) {
      let message = {
        content: null,
        embeds: [
          {
            description: plainTextMessage,
            color: 8035295,
          },
        ],
        attachments: [],
      };

      fetch(process.env.HASTE_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      })
        .then((response) => {
          if (response.ok) {
            console.log("Haste Webhook sent successfully");
          } else {
            console.log("Haste Webhook failed to send");
          }
        })
        .catch((error) => {
          console.error("Error sending webhook:", error);
        });
    }

    if (plainTextMessage.includes(process.env.BOT_USERNAME)) {
      if (process.env.MENTION_WEBHOOK_URL) {
        let message = {
          content: null,
          embeds: [
            {
              description: plainTextMessage,
              color: 16733525,
            },
          ],
          attachments: [],
        };

        fetch(process.env.MENTION_WEBHOOK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        })
          .then((response) => {
            if (response.ok) {
              console.log("Mention Webhook sent successfully");
            } else {
              console.log("Mention Webhook failed to send");
            }
          })
          .catch((error) => {
            console.error("Error sending webhook:", error);
          });
      }
    }
  });

  async function dropItems() {
    const items = bot.inventory.items();

    for (const item of items) {
      try {
        await bot.tossStack(item);
      } catch (error) {
        console.error(`Error dropping item ${item.name}: `, error);
      }
    }
  }
}

createBot();
