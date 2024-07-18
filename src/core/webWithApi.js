
import { Bright, Cyan } from "../modules/sub/consoleText.js";
import { languageCode } from "../modules/sub/utils.js";
import { version, env } from "../modules/config.js";

import { buildFront } from "../modules/build.js";
import findRendered from "../modules/pageRender/findRendered.js";

import { celebrationsEmoji } from "../modules/pageRender/elements.js";
import { changelogHistory } from "../modules/pageRender/onDemand.js";
import {createResponse, getIP, normalizeRequest} from "../modules/processing/request.js";
import rateLimit from "express-rate-limit";
import {generateHmac, generateSalt} from "../modules/sub/crypto.js";
import loc from "../localization/manager.js";
import cors from "cors";
import {extract} from "../modules/processing/url.js";
import match from "../modules/processing/match.js";
import {getInternalStream, verifyStream} from "../modules/stream/manage.js";
import stream from "../modules/stream/stream.js";
import {randomizeCiphers} from "../modules/sub/randomize-ciphers.js";

export async function runWebWithApi(express, app, gitCommit, gitBranch, __dirname) {
    const startTime = new Date();
    const startTimestamp = Math.floor(startTime.getTime());

    await buildFront(gitCommit, gitBranch);

    app.use('/', express.static('./build/min'));
    app.use('/', express.static('./src/front'));

    app.use((req, res, next) => {
        try { decodeURIComponent(req.path) } catch (e) { return res.redirect('/') }
        next();
    })

    app.get('/onDemand', (req, res) => {
        try {
            if (typeof req.query.blockId !== 'string') {
                return res.status(400).json({
                    status: "error",
                    text: "couldn't render this block, please try again!"
                });
            }

            let blockId = req.query.blockId.slice(0, 3);
            let blockData;
            switch(blockId) {
                // changelog history
                case "0":
                    let history = changelogHistory();
                    if (history) {
                        blockData = createResponse("success", { t: history })
                    } else {
                        blockData = createResponse("error", {
                            t: "couldn't render this block, please try again!"
                        })
                    }
                    break;
                // celebrations emoji
                case "1":
                    let celebration = celebrationsEmoji();
                    if (celebration) {
                        blockData = createResponse("success", { t: celebration })
                    }
                    break;
                default:
                    blockData = createResponse("error", {
                        t: "couldn't find a block with this id"
                    })
                    break;
            }

            if (blockData?.body) {
                return res.status(blockData.status).json(blockData.body);
            } else {
                return res.status(204).end();
            }
        } catch {
            return res.status(400).json({
                status: "error",
                text: "couldn't render this block, please try again!"
            })
        }
    })

    app.get("/", (req, res) => {
        return res.sendFile(`${__dirname}/${findRendered(languageCode(req))}`)
    })

    app.get("/favicon.ico", (req, res) => {
        return res.sendFile(`${__dirname}/src/front/icons/favicon.ico`)
    })

    runAPI(express, app, gitCommit, gitBranch, __dirname)

    app.get("/*", (req, res) => {
        return res.redirect('/')
    })

    app.listen(env.webPort, () => {
        console.log(`\n` +
            `${Cyan("cobalt")} WEB With API ${Bright(`v.${version}-${gitCommit} (${gitBranch})`)}\n` +
            `Start time: ${Bright(`${startTime.toUTCString()} (${startTimestamp})`)}\n\n` +
            `URL: ${Cyan(`${env.webURL}`)}\n` +
            `Port: ${env.webPort}\n`
        )
    })
}

const acceptRegex = /^application\/json(; charset=utf-8)?$/;

const ipSalt = generateSalt();
const corsConfig = env.corsWildcard ? {} : {
    origin: env.corsURL,
    optionsSuccessStatus: 200
}

export function runAPI(express, app, gitCommit, gitBranch, __dirname) {
    const startTime = new Date();
    const startTimestamp = startTime.getTime();

    const serverInfo = {
        version: version,
        commit: gitCommit,
        branch: gitBranch,
        name: env.apiName,
        url: env.apiURL,
        cors: Number(env.corsWildcard),
        startTime: `${startTimestamp}`
    }

    const apiLimiter = rateLimit({
        windowMs: env.rateLimitWindow * 1000,
        max: env.rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: req => generateHmac(getIP(req), ipSalt),
        handler: (req, res) => {
            return res.status(429).json({
                "status": "rate-limit",
                "text": loc(languageCode(req), 'ErrorRateLimit', env.rateLimitWindow)
            });
        }
    })

    const apiLimiterStream = rateLimit({
        windowMs: env.rateLimitWindow * 1000,
        max: env.rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: req => generateHmac(getIP(req), ipSalt),
        handler: (req, res) => {
            return res.sendStatus(429)
        }
    })

    app.set('trust proxy', ['loopback', 'uniquelocal']);

    app.use('/api', cors({
        methods: ['GET', 'POST'],
        exposedHeaders: [
            'Ratelimit-Limit',
            'Ratelimit-Policy',
            'Ratelimit-Remaining',
            'Ratelimit-Reset'
        ],
        ...corsConfig,
    }))

    app.use('/api/json', apiLimiter);
    app.use('/api/stream', apiLimiterStream);

    app.use((req, res, next) => {
        try {
            decodeURIComponent(req.path)
        } catch {
            return res.redirect('/')
        }
        next();
    })

    app.use('/api/json', express.json({
        verify: (req, res, buf) => {
            if (String(req.header('Accept')) === "application/json") {
                if (buf.length > 720) throw new Error();
                JSON.parse(buf);
            } else {
                throw new Error();
            }
        }
    }))

    // handle express.json errors properly (https://github.com/expressjs/express/issues/4065)
    app.use('/api/json', (err, req, res, next) => {
        let errorText = "invalid json body";
        const acceptHeader = String(req.header('Accept')) !== "application/json";

        if (err || acceptHeader) {
            if (acceptHeader) errorText = "invalid accept header";
            return res.status(400).json({
                status: "error",
                text: errorText
            });
        } else {
            next();
        }
    })

    app.post('/api/json', async (req, res) => {
        const request = req.body;
        const lang = languageCode(req);

        const fail = (t) => {
            const { status, body } = createResponse("error", { t: loc(lang, t) });
            res.status(status).json(body);
        }

        if (!acceptRegex.test(req.header('Content-Type'))) {
            return fail('ErrorInvalidContentType');
        }

        if (!request.url) {
            return fail('ErrorNoLink');
        }

        request.dubLang = request.dubLang ? lang : false;
        const normalizedRequest = normalizeRequest(request);
        if (!normalizedRequest) {
            return fail('ErrorCantProcess');
        }

        const parsed = extract(normalizedRequest.url);
        if (parsed === null) {
            return fail('ErrorUnsupported');
        }

        try {
            const result = await match(
              parsed.host, parsed.patternMatch, lang, normalizedRequest
            );

            res.status(result.status).json(result.body);
        } catch {
            fail('ErrorSomethingWentWrong');
        }
    })

    app.get('/api/stream', (req, res) => {
        const id = String(req.query.id);
        const exp = String(req.query.exp);
        const sig = String(req.query.sig);
        const sec = String(req.query.sec);
        const iv = String(req.query.iv);

        const checkQueries = id && exp && sig && sec && iv;
        const checkBaseLength = id.length === 21 && exp.length === 13;
        const checkSafeLength = sig.length === 43 && sec.length === 43 && iv.length === 22;

        if (!checkQueries || !checkBaseLength || !checkSafeLength) {
            return res.sendStatus(400);
        }

        // rate limit probe, will not return json after 8.0
        if (req.query.p) {
            return res.status(200).json({
                status: "continue"
            })
        }

        const streamInfo = verifyStream(id, sig, exp, sec, iv);
        if (!streamInfo?.service) {
            return res.sendStatus(streamInfo.status);
        }
        return stream(res, streamInfo);
    })

    app.get('/api/istream', (req, res) => {
        if (!req.ip.endsWith('127.0.0.1')) {
            return res.sendStatus(403);
        }

        if (String(req.query.id).length !== 21) {
            return res.sendStatus(400);
        }

        const streamInfo = getInternalStream(req.query.id);
        if (!streamInfo) {
            return res.sendStatus(404);
        }

        streamInfo.headers = new Map([
            ...(streamInfo.headers || []),
            ...Object.entries(req.headers)
        ]);

        return stream(res, { type: 'internal', ...streamInfo });
    })

    app.get('/api/serverInfo', (_, res) => {
        return res.status(200).json(serverInfo);
    })

    app.get('/favicon.ico', (req, res) => {
        res.sendFile(`${__dirname}/src/front/icons/favicon.ico`)
    })

    app.get('/api/*', (req, res) => {
        res.redirect('/api/serverInfo')
    })
}
