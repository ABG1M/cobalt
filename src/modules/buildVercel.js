import * as esbuild from "esbuild";
import * as fs from "fs";
import {languageList, loadLoc} from "../localization/manager.js";
import {cleanHTML} from "./sub/utils.js";
import page from "./pageRender/page.js";
import {getCurrentBranch, shortCommit} from "./sub/currentCommit.js";

export async function buildFront(commitHash, branch) {
  try {
    // preload localization files
    await loadLoc();

    // build html
    if (!fs.existsSync('./public/')) {
      fs.mkdirSync('./public/');
    }

    // cp others
    fs.cpSync("./src/front", "./public/", {
      force: true, recursive: true,
      filter(source, destination) {
        return !source.endsWith('cobalt.js') && !source.endsWith('cobalt.css')
      }
    })

    for (let i in languageList) {
      i = languageList[i];
      let params = {
        "hash": commitHash,
        "lang": i,
        "branch": branch
      }
      fs.writeFileSync(`./public/${i}.html`, cleanHTML(page(params)));
    }

    // build js & css
    await esbuild.build({
      entryPoints: ['src/front/cobalt.js', 'src/front/cobalt.css'],
      outdir: 'public',
      minify: true,
      loader: {'.js': 'js', '.css': 'css',},
      charset: 'utf8'
    })
  } catch {
    return;
  }
}

const commitHash = shortCommit();
const branch = getCurrentBranch();

await buildFront(commitHash, branch);

// cp others
fs.cpSync("./src", "./api/src", {
  force: true, recursive: true,
  filter(source, destination) {
    return source.indexOf('src/front') < 0;
  }
})
