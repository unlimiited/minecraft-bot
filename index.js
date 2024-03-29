const mineflayer = require("mineflayer");
const { mapDownloader } = require('mineflayer-item-map-downloader')
const fetch = require("node-fetch");
require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const { S3Client, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

let reconnectAttempts = 0;
const solvedMaps = new Set();
let lastBotMessage = "";
let lastUploadedMapKey = "";

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

function createBot() {
  const options = {
    host: process.env.SERVER,
    port: 25565,
    username: process.env.BOT_USERNAME,
    auth: "microsoft",
    version: "1.19.3",
    "mapDownloader-outputDir": "./maps",
  };

  const bot = mineflayer.createBot(options);
  const discordBot = createDiscordBot();

  bot.loadPlugin(mapDownloader)

  bot.once("spawn", () => {
    const interval = (process.env.AMS_INTERVAL ? parseInt(process.env.AMS_INTERVAL) : 10) * 1000;

    if (process.env.AMS_CHECK === "true") {
      setInterval(async () => {
        if(process.env.AMS_ACCESS_MODE === "command") { 
            bot.chat("/ams");
        } else {
            const targetBlock = bot.blockAtCursor();
    
            if (!targetBlock) {
                console.log("No target block in sight.");
                return;
            }
    
            const nextSlot = bot.quickBarSlot === 7 ? 8 : 7;
            bot.setQuickBarSlot(nextSlot);
    
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
    }

    if (process.env.DISCORD_BOT_TOKEN) {
      discordBot.on('messageCreate', async message => {
        if (message.author.bot) return;
    
        if (message.author.id === process.env.DISCORD_USER_ID) {
          if (message.channel.id === process.env.AMS_CHANNEL_ID) {
            bot.chat(message.content);
            lastBotMessage = message.content;
          }
        }
      });
    }
  });

  bot.on("windowOpen", (window) => {
    if (process.env.AMS_CHECK === "true") {
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
                    if (process.env.AMS_CHANNEL_ID) {
                      sendEmbedMessage(discordBot, process.env.AMS_CHANNEL_ID, 13938487, balance);
                      bot.clickWindow(goldIngotSlot, 0, 0);
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
        } else {
          console.log("NBT data is not in the expected format for item:", item);
        }
      } else {
        console.log("Gold ingot not found in the opened window.");
      }
    }
  });

  bot.on("new_map_saved", (map) => {
    const channelId = process.env.AMS_CHANNEL_ID;    
    sendImageMessage(discordBot, channelId, `./maps/${map.name.replace(/"/g, "")}`);

    if (process.env.MAP_UPLOAD === "true") {
      if (!solvedMaps.has(map.name)) {
        uploadToS3(`./maps/${map.name.replace(/"/g, "")}`, `maps/unsolved/${map.name.replace(/"/g, "")}`);
      }
    }

    setTimeout(() => {
      fs.rmSync(`./maps/${map.name.replace(/"/g, "")}`, { recursive: true });
    }
    , 5000);
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
        lastBotMessage = content;
      }
    }

    if (plainTextMessage.startsWith("AMS ►► ") && plainTextMessage.includes("abgehoben")) {
      if (process.env.AMS_CHANNEL_ID) {
        sendEmbedMessage(discordBot, process.env.AMS_CHANNEL_ID, 16733525, plainTextMessage);
        let balance = plainTextMessage.substring(
          "AMS ►► Du hast ".length,
          plainTextMessage.indexOf("$"),
        );
        balance = balance.replace(/\./g, "");
        if (process.env.AMS_AUTO_PAY === "true") {
          bot.chat(`/pay ${process.env.BOT_OWNER_USERNAME} ${balance}`);
        }
      }

      if (process.env.MAP_UPLOAD === "true") {
        const newKey = `maps/solved/${lastBotMessage}.png`;
        replaceObject(lastUploadedMapKey, newKey);
      }
    }    

    if (
      plainTextMessage.startsWith(
        `MONEY ►► ${process.env.BOT_OWNER_USERNAME} hat dir` &&
        process.env.JACKPOT_JOIN_ON_PAY === "true",
      )
    ) {
      bot.chat("/pot max");
    }

    if (plainTextMessage.startsWith(`►► ${options.username} hat `) && process.env.JACKPOT_TRANSFER_WIN === "true") {
      const balance = plainTextMessage.substring(
        `►► ${options.username} hat`.length,
        plainTextMessage.indexOf("$"),
      );
      const money = balance.replace(/\./g, "");
      bot.chat(
        `/pay ${process.env.BOT_OWNER_USERNAME} ${Math.round(money * 0.88)} `,
      );
    }

    if (
      plainTextMessage.startsWith("MSG ►► ") &&
      plainTextMessage.includes(" » Mir: ") &&
      !plainTextMessage.startsWith(authString)
    ) {
      if (process.env.MSG_CHANNEL_ID && process.env.DISCORD_BOT_TOKEN) {
        const username = plainTextMessage.substring(
          "MSG ►► ".length,
          plainTextMessage.indexOf(" » Mir: "),
        );
        const content = plainTextMessage.substring(
          plainTextMessage.indexOf(" » Mir: ") + " » Mir: ".length,
        );
        sendEmbedMessage(discordBot, process.env.MSG_CHANNEL_ID, 8375321, `${username} schrieb per MSG an ${options.username}: ${content}`);
      }
    }

    if (
      plainTextMessage.startsWith(
        "BOOSTER ►► Es wurde ein globaler HasteBooster",
      ) &&
      process.env.HASTE_CHANNEL_ID
    ) {
      sendEmbedMessage(discordBot, process.env.HASTE_CHANNEL_ID, 8035295, plainTextMessage);
    }

    if (plainTextMessage.includes(process.env.BOT_USERNAME)) {
      if (process.env.MENTION_CHANNEL_ID) {
        sendEmbedMessage(discordBot, process.env.MENTION_CHANNEL_ID, 16733525, plainTextMessage);
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

function createDiscordBot() {
  if (!process.env.DISCORD_BOT_TOKEN) {
      console.error('Discord bot token not provided.');
      return null;
  }

  let bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

  bot.once('ready', () => {
      console.log('Discord | Logged in as ' + bot.user.tag);
  });

  bot.login(process.env.DISCORD_BOT_TOKEN);

  return bot;
};

function sendEmbedMessage(bot, channelId, color, messageText) {
  if (!bot || !bot.isReady()) {
      console.error('Discord bot is not initialized or not ready.');
      return Promise.reject('Bot not ready');
  }

  const channel = bot.channels.cache.get(channelId);
  if (!channel) {
      console.error(`Channel with ID ${channelId} not found.`);
      return Promise.reject('Channel not found');
  }

  const embed = new EmbedBuilder()
      .setColor(color)
      .setDescription(messageText);

  return channel.send({ embeds: [embed] })
      .then(message => {
          console.log(`Embed message sent: ${messageText}`);
          return message.id;
      })
      .catch(error => {
          console.error(error);
          return Promise.reject(error);
      });
}

function sendImageMessage(bot, channelId, imagePath) {
  if (!bot || !bot.isReady()) {
      console.error('Discord bot is not initialized or not ready.');
      return Promise.reject('Bot not ready');
  }

  const channel = bot.channels.cache.get(channelId);
  if (!channel) {
      console.error(`Channel with ID ${channelId} not found.`);
      return Promise.reject('Channel not found');
  }

  const attachment = new AttachmentBuilder(imagePath);

  return channel.send({ files: [attachment] })
      .then(message => {
          console.log(`Image sent: ${imagePath}`);
          return message.id;
      })
      .catch(error => {
          console.error(error);
          return Promise.reject(error);
      });
}

async function uploadToS3(localPath, s3Path) {
  try {
    const fileStream = fs.createReadStream(localPath);

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: s3Path,
        Body: fileStream,
      },
    });

    const result = await upload.done();
    console.log("Upload Success", result.Location);
    lastUploadedMapKey = s3Path;
  } catch (err) {
    console.log("Error", err);
  }
}

async function replaceObject(sourceKey, newKey) {
  try {
    await s3Client.send(new CopyObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      CopySource: `${process.env.AWS_BUCKET_NAME}/${sourceKey}`,
      Key: newKey,
    }));
    console.log("Copy success");

    await s3Client.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: sourceKey,
    }));
    console.log("Delete success");
  } catch (err) {
    console.error("Error during copy/delete operation", err);
  }
}

createBot();
