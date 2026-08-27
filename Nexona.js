const {
    Client,
    GatewayIntentBits
} = require("discord.js");

require("dotenv").config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;

client.once("ready", () => {
    console.log(`Nexona is online as ${client.user.tag}`);
});

client.on("error", (error) => {
    console.error("Nexona Error:", error);
});

client.login(TOKEN);