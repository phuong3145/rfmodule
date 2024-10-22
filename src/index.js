import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import axios from 'axios';
import { setTimeout as wait } from 'timers/promises';
import { HttpsProxyAgent } from 'https-proxy-agent';

export class TelegramDataFetcher {
  constructor(config) {
    this.pathToLocalStorage = config.pathToLocalStorage;
    this.pathToLogClaim = config.pathToLogClaim;
    this.pathToLogProxy = config.pathToLogProxy;
    this.pathToAccount = config.pathToAccount;
    this.userAgents = config.userAgents;
    this.refcode = config.refcode;
    this.browsers = new Set();
  }

  GetTime() {
    const currentDate = new Date();
    const day = currentDate.getDate();
    const month = currentDate.getMonth() + 1;
    const year = currentDate.getFullYear();
    const hours = currentDate.getHours();
    const minutes = currentDate.getMinutes();
    const formatNumber = (num) => (num < 10 ? '0' + num : num);
    return `${formatNumber(day)}/${formatNumber(month)}/${year} ${formatNumber(hours)}:${formatNumber(minutes)}`;
  }

  async checkProxy(proxy) {
    if (!proxy) return false;

    const proxyUrl = 'http://' + proxy;
    const proxyAgent = new HttpsProxyAgent(proxyUrl);
    try {
      const response = await axios.get('https://api.ipify.org?format=json', {
        httpsAgent: proxyAgent
      });
      if (response.status === 200) {
        console.log(`Proxy ${proxy} / IP ${response.data.ip}`);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async setupBrowser(proxy) {
    let browser = null;
    let page = null;

    if (proxy) {
      const [credentials, address] = proxy.split('@');
      const [username, password] = credentials.split(':');
      browser = await puppeteer.launch({
        headless: true,
        defaultViewport: null,
        args: [`--proxy-server=http://${address}`]
      });
      page = await browser.newPage();
      await page.authenticate({ username, password });
      console.log(`Sử dụng Proxy: ${proxy}`);
      console.log('-'.repeat(50));
    } else {
      browser = await puppeteer.launch({
        headless: true,
        defaultViewport: null
      });
      page = await browser.newPage();
    }

    this.browsers.add(browser);
    return { browser, page };
  }

  async GetTgData(accID, proxy) {
    const time = this.GetTime();
    const randomAgent = this.userAgents.Chrome[Math.floor(Math.random() * this.userAgents.Chrome.length)];

    const isProxyWorking = !proxy || await this.checkProxy(proxy);

    if (!isProxyWorking) {
      console.error('\x1b[31m%s\x1b[0m', `${time} Proxy ${proxy} không hoạt động.` + '\n' + '-'.repeat(50));
      fs.appendFileSync(this.pathToLogProxy, `${time} Proxy ${proxy} không hoạt động.\n`);
      return { success: false, error: 'Proxy not working' };
    }

    try {
      const { browser, page } = await this.setupBrowser(proxy);
      await page.setUserAgent(randomAgent);

      try {
        // Load local storage data
        const localStoragePath = path.join(this.pathToLocalStorage, `${accID}.json`);
        const localStorageData = JSON.parse(fs.readFileSync(localStoragePath, 'utf8'));
        await page.evaluateOnNewDocument((data) => {
          for (let key in data) {
            localStorage.setItem(key, data[key]);
          }
        }, localStorageData);

        // Navigate and interact with Telegram
        const URLR = new URL(`https://web.telegram.org/k/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3Dnotpixel%26appname%3Dapp%26startapp%3D${this.refcode}`);
        await page.goto(URLR, { waitUntil: 'networkidle0' });
        await wait(6000);

        await page.waitForSelector('button.popup-button.btn.primary.rp', { timeout: 30000 });
        const LaunchApp = await page.$('button.popup-button.btn.primary.rp');
        await LaunchApp.click();

        await page.waitForSelector('iframe.payment-verification', { timeout: 30000 });
        const iframeElement = await page.$('iframe.payment-verification');
        const iframeSrc = await page.evaluate(iframe => iframe.src, iframeElement);

        let tg_login = null;
        if (iframeSrc?.includes('tgWebAppData=')) {
          const url = new URL(iframeSrc);
          const params = new URLSearchParams(url.hash.slice(1));
          const tgWebAppData = params.get('tgWebAppData');

          if (tgWebAppData) {
            const decodedData = decodeURIComponent(decodeURIComponent(tgWebAppData));
            const tgParams = new URLSearchParams(decodedData);
            const newParams = [];

            tgParams.forEach((value, key) => {
              if (value && value !== 'null') {
                newParams.push(`${key}=${encodeURIComponent(value)}`);
              }
            });

            tg_login = newParams.join('&');
          }
        }

        await wait(10000);
        await browser.close();
        return { success: true, tg_login };

      } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `Lỗi quá trình lấy TgData ${time} ${accID}: ${error}` + '\n' + '-'.repeat(50));
        fs.appendFileSync(this.pathToLogClaim, `Lỗi quá trình lấy TgData ${time} ${accID}: ${error}\n`);
        await browser.close();
        return { success: false, error };
      }
    } catch (error) {
      console.error('\x1b[31m%s\x1b[0m', `Lỗi GetTgData ${time} ${accID}: ${error}` + '\n' + '-'.repeat(50));
      fs.appendFileSync(this.pathToLogClaim, `Lỗi GetTgData ${time}: ${error}\n`);
      return { success: false, error };
    }
  }

  async cleanup() {
    for (const browser of this.browsers) {
      try {
        await browser.close();
      } catch (err) {
        console.error(`Error closing browser: ${err}`);
      }
    }
  }
}