import { HttpProxyAgent } from 'http-proxy-agent';

const one_hour = 3600000;
const MAX_WHITE_FAILURES = 5;

export function DuplexProxy(extras) {
    const {
        jumper = 3,
        jumps = Infinity,
        fetchTimeout = 30_000,
        restIntervalCount = 30,
        restTimer = 30000,
        ackResponse,
        logProxy,
        fetcherProxy,
        proxyCrawlerUrlEntries,
        autoInstallProxies,
        installer
    } = { ...extras };

    Object.entries({
        fetchTimeout,
        restIntervalCount,
        restTimer,
        jumper,
        jumps
    }).forEach(([k, v]) => {
        if (!Number.isInteger(v)) {
            if (k !== 'jumps' || v !== Infinity)
                throw `${k} should be an integer but got ${v}`;
        }
    });

    if (ackResponse !== undefined && typeof ackResponse !== 'function')
        throw `ackResponse should be a function but got ${ackResponse}`;

    if (autoInstallProxies) {
        if (!installer && !proxyCrawlerUrlEntries?.length)
            throw 'when autoInstallProxies is truthy, installer or proxyCrawlerUrlEntries must be provided';
    }

    const proxyVerse = {
        timer: undefined,
        lastChecked: Date.now(),
        isInstalling: false,
        /**
         * @type {Promise<void> | undefined}
         */
        installationPromise: undefined,
        list: [],
        listIte: 0,
        whitelist: {
            failures: {},
            list: [],
            cursor: 0
        }
    };

    const installProxy = async () => {
        if (!autoInstallProxies && !installer) return;
        if (proxyVerse.installationPromise) return proxyVerse.installationPromise;
        if (logProxy) console.warn('installing proxies');
        let proxySize;

        proxyVerse.installationPromise = installer?.() || (async () => {
            clearTimeout(proxyVerse.timer);

            const liveProxies = await crawlProxy(fetcherProxy, proxyCrawlerUrlEntries);
            proxyVerse.list = liveProxies;
            proxyVerse.listIte = 0;
            proxyVerse.lastChecked = Date.now();
            proxySize = liveProxies.length;

            if (autoInstallProxies)
                proxyVerse.timer = setTimeout(() => {
                    if (
                        Date.now() - proxyVerse.lastChecked >= one_hour * 5 ||
                        !!Math.floor(proxyVerse.listIte / proxyVerse.list.length)
                    ) {
                        installProxy();
                    } else proxyVerse.timer.refresh();
                }, one_hour);
        })();

        await proxyVerse.installationPromise;
        proxyVerse.installationPromise = undefined;
        if (logProxy) console.warn('proxy installation success size:', proxySize);
    }

    installProxy();

    const gracefullyKill = !autoInstallProxies;

    return {
        __donot_modify_verse: proxyVerse,
        add: url => {
            new URL(url);
            if (!proxyVerse.list.includes(url))
                proxyVerse.list.push(url);
        },
        fetch: async (url, options) => {
            let ite = 0, isWhite;
            const jumpCount = Number.isInteger(jumper) ? jumper : 10;

            const jump = async () => {
                isWhite = !isWhite;
                if (
                    ++ite > jumps &&
                    jumps !== Infinity
                ) throw 'Jumbs exceeded';
                let partialProxy;

                if (isWhite) {
                    Object.entries({ ...proxyVerse.whitelist.failures }).forEach(([k, v]) => {
                        if (v >= MAX_WHITE_FAILURES) {
                            proxyVerse.whitelist.list =
                                proxyVerse.whitelist.list.filter(x => x !== k);
                            delete proxyVerse.whitelist.failures[k];
                        }
                    });

                    if (!proxyVerse.whitelist.list.length) {
                        console.warn('no white lists');
                        return (await jump());
                    }
                    if (
                        ++proxyVerse.whitelist.cursor >
                        proxyVerse.whitelist.list.length - 1
                    ) {
                        proxyVerse.whitelist.cursor = 0;
                    }
                    partialProxy = [
                        proxyVerse.whitelist.list[proxyVerse.whitelist.cursor]
                    ];
                } else {
                    if (proxyVerse.installationPromise) await proxyVerse.installationPromise;
                    if (!proxyVerse.list.length) {
                        if (!proxyVerse.whitelist.list.length) {
                            if (gracefullyKill) {
                                throw 'empty whitelist';
                            } else {
                                await wait(10_000);
                                await installProxy();
                            }
                        }
                        return (await jump());
                    }

                    const startCursor = proxyVerse.listIte % proxyVerse.list.length;

                    partialProxy = proxyVerse.list.slice(
                        startCursor,
                        Math.min(
                            startCursor + jumpCount,
                            proxyVerse.list.length
                        )
                    );
                    proxyVerse.listIte += jumpCount;
                }
                if (logProxy) console.log('jumping proxies:', partialProxy, ' ite:', ite);

                const jumperResult = await Promise.all(partialProxy.map(async proxy => {
                    try {
                        const response = await timeoutFetch(url, {
                            ...options,
                            agent: new HttpProxyAgent(proxy)
                        }, fetchTimeout);

                        const { success, commit, error } = ackResponse ? await ackResponse(response, proxy)
                            : { success: true, commit: response };

                        if (!success) throw error || 'not_acknownledge';
                        if (!isWhite) {
                            if (!proxyVerse.whitelist.list.includes(proxy)) {
                                proxyVerse.whitelist.list.push(proxy);
                            }
                        }

                        return { success, commit, proxy };
                    } catch (e) {
                        if (isWhite) {
                            if (!Number.isInteger(proxyVerse.whitelist.failures[proxy]))
                                proxyVerse.whitelist.failures[proxy] = 0;
                            ++proxyVerse.whitelist.failures[proxy];
                        }
                        return { error: `${e}` };
                    }
                }));
                const successfulJump = jumperResult.find(v => v.success);

                if (successfulJump) {
                    jumperResult.forEach(j => {
                        if (
                            j.success &&
                            isWhite &&
                            j.proxy in proxyVerse.whitelist.failures
                        ) {
                            delete proxyVerse.whitelist.failures[j.proxy];
                        }
                    });
                    return successfulJump.commit;
                } else if (!isWhite && proxyVerse.listIte >= proxyVerse.list.length) {
                    installProxy();
                }

                if (ite && !(ite % restIntervalCount)) await wait(restTimer); // rest for some seconds
                return (await jump());
            };
            return (await jump());
        }
    }
};

async function crawlProxy(fetcherProxy, entries) {
    const crawledProxy = await Promise.all(entries.map(async url => {
        try {
            const responseTxt = await (await timeoutFetch(url, fetcherProxy ? { agent: new HttpProxyAgent(fetcherProxy) } : undefined, 20_000)).text();
            const ips = responseTxt.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}\b/g).map(v =>
                `http://${v}`
            );
            if (!ips) throw 'no ip found';
            return ips;
        } catch (e) {
            console.error('proxy request url:', url, ' err:', e);
            return [];
        }
    }));

    const proxyResults = (
        await Promise.all([
            ...new Set(crawledProxy.flat())
        ].slice(0, 30).map(async url => { // TODO:
            try {
                const kk = await (
                    await timeoutFetch('http://httpbin.org/ip', {
                        agent: new HttpProxyAgent(url)
                    }, 7000)
                ).json();
                if (kk.origin) return url;
            } catch (_) { }
        }))
    );
    return proxyResults.filter(v => v);
};

/**
 * @param {URL | import("node-fetch").RequestInfo} url 
 * @param {import("node-fetch").RequestInit} option 
 * @param {number} timeout
 */
export const timeoutFetch = async (url, option, timeout = 60000) => {
    const signal = new AbortController();

    const timer = setTimeout(() => {
        signal.abort();
    }, timeout);

    const r = await fetch(url, { ...option, signal: signal.signal }).then(async h => {
        const response = new Response(await h.arrayBuffer(), {
            headers: h.headers,
            status: h.status,
            statusText: h.statusText
        });
        return response;
    });
    clearTimeout(timer);
    return r;
};

const wait = (ms = 1000) => new Promise(resolve => {
    setTimeout(resolve, ms);
});