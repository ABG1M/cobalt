import puppeteer from "puppeteer";
import {genericUserAgent} from "../../config.js";
import {updateCookie} from "../cookie/manager.js";
import Cookie from "../cookie/cookie.js";

class VideoCrawler {
  constructor() {
    this.browser = null;
  }

  async initialize() {
    if (!this.browser) {
      this.browser = await puppeteer.launch();
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

const crawler = new VideoCrawler();

function getMimeTypeExtension(mimeType) {
  const mimeTypeMap = {
    'video_mp4': '.mp4',
    'video_webm': '.webm',
    'video_ogg': '.ogg',
    'video_quicktime': '.mov',
    'video_x_msvideo': '.avi',
    'video_x_matroska': '.mkv',
    'video_x_flv': '.flv',
    // 可以根据需要添加更多的映射
  };

  return mimeTypeMap[mimeType] || '.mp4';
}

let cookieStr = "ttwid=1%7Cs7Pjqk-hjSszoZj97ThWaIjqMtoLpIJ6ZULIZB88VG0%7C1721316728%7C76b8178440404855caaf49a8ece7d3081867b0c5d707acccb18b4928cdda4a2e;";

export default async function ({id, host}) {
  try {
    const cookie = Cookie.fromString(cookieStr);
    const res_1 = await fetch(`https://www.toutiao.com/video/${id}/`, {
      headers: {
        "user-agent": genericUserAgent,
        cookie,
      }
    })
    updateCookie(cookie, res_1.headers);

    const res_2 = await fetch(`https://www.toutiao.com/ttwid/check/`, {
      method: 'POST',
      headers: {
        "User-Agent": genericUserAgent,
        "cookie": cookieStr
      },
      body: JSON.stringify({
        "aid": 24,
        "service": "www.toutiao.com",
        "region": "cn",
        "union": true,
        "needFid": false,
        "fid": "",
        "migrate_priority": 0
      })
    })

    updateCookie(cookie, res_2.headers);
    cookieStr = cookie.toString();

    const res = await fetch(`https://www.toutiao.com/video/${id}/`, {
      headers: {
        "user-agent": genericUserAgent,
        "cookie": cookie
      }
    })
    const html = await res.text();
    //<script id="RENDER_DATA" type="application/json">
    if (!html.includes('<script id="RENDER_DATA" type="application/json">')) {
      return {error: 'ErrorEmptyDownload'};
    }
    let encodedJson = html.split('<script id="RENDER_DATA" type="application/json">')[1].split('</script>')[0];
    let json = decodeURIComponent(encodedJson.replace(/\+/g, ' '));
    let obj = JSON.parse(json).data;
    let title = obj.seoTDK.title;
    let videoList = obj.initialVideo.videoPlayInfo.video_list;
    let video = videoList[videoList.length - 1];
    let vtype = video.video_meta.vtype;
    return {
      urls: video.main_url,
      filename: `toutiao_${title}.${vtype}`,
      audioFilename: `toutiao_${title}`,
    };
  } catch (e) {
    console.error('Invalid URL:', e);
  }
  return {error: 'ErrorCouldntFetch'};
}

