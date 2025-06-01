import { HttpProxyAgent } from 'http-proxy-agent';
import { FetcherProxy, ProxyVerseReadyListener, Scope, TestMainProxy } from './variables';
import fetch, { Response } from 'node-fetch';
import { one_hour, randomArrayItem, wait } from '../../shared_values/common_values';
import { IS_DEV, IS_PRODUCTION } from '../env';
import { timeoutFetch } from '../peripherals';

export const Scope = {
    IN_MAINTAINANCE: false,
    MicroServers: new Promise(resolve => {
        globalThis.microServersResolveX = resolve;
    }),
    MicroServiceDisabled: false,
    MicroServicePendingResolutions: {},
    PendingStorageUpload: {},
    activeUsers: {},
    ProcessingMentionName: {},
    AbsoluteIterator: 0,
    UpgradePlanExpiryTimer: {},
    ChallengeExpiryTimer: {},
    ChallengeTimer: {},
    terminalContent: [],
    terminalContentSize: 0,
    autoAdsPurge: {},
    ChallengeMatcher: {},
    DailyQuestProcess: {},
    DailyQuestResetTimer: {},
    LeaderboardResetTimer: undefined,
    translations: {
        ite: 0,
        timer: undefined,
        promises: {},
        lastDate: undefined,
        limiter: {
            count: 0,
            chars: 0
        }
    },
    proxyVerse: {
        timer: undefined,
        lastChecked: Date.now(),
        isInstalling: false,
        flags: {
            duckduckgo: 'duckduckgo',
            translation: 'translation',
        },
        list: [],
        listIte: {
            duckduckgo: 0,
            translation: 0
        },
        /**
         * @type {{[key: string]: {failures: {}, list: [], cursor: number}}}
         */
        whitelist: {
            translation: {
                failures: {},
                list: [],
                cursor: 0
            },
            duckduckgo: {
                failures: {},
                list: [],
                cursor: 0
            }
        }
    }
};

async function scrapProxy() {
    if (Scope.proxyVerse.isInstalling) return;
    Scope.proxyVerse.isInstalling = true;
    ProxyVerseReadyListener.dispatch('d');

    clearTimeout(Scope.proxyVerse.timer);
    console.log('installing proxies');
    const crawledProxy = await Promise.all([
        ...IS_PRODUCTION ? [
            'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&proxy_format=protocolipport&format=text&timeout=12208',
            'https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt',
            'https://raw.githubusercontent.com/elliottophellia/yakumo/master/results/http/global/http_checked.txt',
            'https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt',
            'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
            'https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/http_proxies.txt',
            'https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/http.txt',
            'https://raw.githubusercontent.com/ProxyScraper/ProxyScraper/main/http.txt',
            'https://raw.githubusercontent.com/MrMarble/proxy-list/main/all.txt',
            'https://raw.githubusercontent.com/TuanMinPay/live-proxy/master/http.txt',
            'https://raw.githubusercontent.com/saisuiu/Lionkings-Http-Proxys-Proxies/main/free.txt',
            'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt',
            'https://raw.githubusercontent.com/proxylist-to/proxy-list/main/http.txt',
            'https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/http.txt',
            'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/http/http.txt'
        ] : []
    ].map(async url => {
        try {
            const useProxy = url.startsWith('https://raw.githubusercontent.com/');
            const commonProxy = useProxy && (
                Object.values(Scope.proxyVerse.whitelist).map(v => v.list).flat().map((v, _, a) =>
                    [v, a.filter(x => x === v).length]
                ).sort((a, b) => a[1] - b[1]).pop()?.[0]
                || randomArrayItem(FetcherProxy)
            );

            const ips = (
                await (await timeoutFetch(url, commonProxy ? { agent: new HttpProxyAgent(commonProxy) } : undefined, 20_000)).text()
            ).match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}\b/g).map(v =>
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
        ].map(async url => {
            try {
                const kk = await (await timeoutFetch('http://httpbin.org/ip', {
                    agent: new HttpProxyAgent(url)
                }, 7000)).json();
                if (kk.origin) return url;
            } catch (_) { }
        }))
    );
    const liveProxies = proxyResults.filter(v => v);

    if (IS_DEV) {
        console.log('liveProxies:', liveProxies);
    } else {
        console.warn('valid proxy:', liveProxies.length, ' dumped proxy:', proxyResults.filter(v => !v).length);
    }

    Scope.proxyVerse.list = liveProxies;
    Object.keys(Scope.proxyVerse.listIte).forEach(e => {
        Scope.proxyVerse.listIte[e] = 0;
    });

    Scope.proxyVerse.timer = setTimeout(() => {
        if (
            Date.now() - Scope.proxyVerse.lastChecked >= one_hour * 5 ||
            Object.values(Scope.proxyVerse.listIte).some(v =>
                !!Math.floor(v / Scope.proxyVerse.list.length)
            )
        ) {
            scrapProxy();
        } else Scope.proxyVerse.timer.refresh();
    }, one_hour);
    Scope.proxyVerse.isInstalling = false;
    ProxyVerseReadyListener.dispatch('d', 'ready');
}
scrapProxy();

const waitProxyInstallation = async () => {
    if (Scope.proxyVerse.isInstalling)
        await new Promise(resolve => {
            const l = ProxyVerseReadyListener.listenTo('d', v => {
                if (v === 'ready' && !Scope.proxyVerse.isInstalling) {
                    l();
                    resolve();
                }
            });
        });
};

const MAX_WHITE_FAILURES = 5;

export default function (url, options, extras) {
    let { flag = '', jumper = 3, jumps = Infinity, jumpTimeout = 7000, restTimer = 30000 } = { ...extras };

    return async (callback) => {
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
                Object.entries({ ...Scope.proxyVerse.whitelist[flag].failures }).forEach(([k, v]) => {
                    if (v >= MAX_WHITE_FAILURES) {
                        Scope.proxyVerse.whitelist[flag].list =
                            Scope.proxyVerse.whitelist[flag].list.filter(x => x !== k);
                        delete Scope.proxyVerse.whitelist[flag].failures[k];
                    }
                });

                if (!Scope.proxyVerse.whitelist[flag].list.length) {
                    console.warn('no white lists');
                    return (await jump());
                }
                if (
                    ++Scope.proxyVerse.whitelist[flag].cursor >
                    Scope.proxyVerse.whitelist[flag].list.length - 1
                ) {
                    Scope.proxyVerse.whitelist[flag].cursor = 0;
                }
                partialProxy = [
                    Scope.proxyVerse.whitelist[flag].list[Scope.proxyVerse.whitelist[flag].cursor]
                ];
            } else {
                await waitProxyInstallation();
                if (!Scope.proxyVerse.list.length) {
                    if (!Scope.proxyVerse.whitelist[flag].list.length) {
                        if (IS_DEV) {
                            throw 'empty whitelist';
                        } else {
                            await wait(1000);
                            await scrapProxy();
                        }
                    }
                    return (await jump());
                }

                const startCursor = Scope.proxyVerse.listIte[flag] % Scope.proxyVerse.list.length;

                partialProxy = Scope.proxyVerse.list.slice(
                    startCursor,
                    Math.min(
                        startCursor + jumpCount,
                        Scope.proxyVerse.list.length
                    )
                );
                Scope.proxyVerse.listIte[flag] += jumpCount;
            }
            if (IS_DEV) console.log('jumping proxies:', partialProxy, ' ite:', ite);

            const jumperResult = await Promise.all(partialProxy.map(async proxy => {
                try {
                    const abortion = new AbortController();
                    const bomb = setTimeout(() => {
                        abortion.abort();
                    }, jumpTimeout);

                    const h = await fetch(url, {
                        ...options,
                        agent: new HttpProxyAgent(proxy),
                        signal: abortion.signal
                    });
                    const response = new Response(await h.arrayBuffer(), {
                        headers: h.headers,
                        status: h.status,
                        statusText: h.statusText
                    });

                    clearTimeout(bomb);
                    const { success, commit, error } = await callback(response, proxy);

                    if (!success) throw error || 'not_acknownledge';
                    if (!isWhite) {
                        if (!Scope.proxyVerse.whitelist[flag].list.includes(proxy)) {
                            Scope.proxyVerse.whitelist[flag].list.push(proxy);
                        }
                    }

                    return { success, commit, proxy };
                } catch (e) {
                    if (isWhite) {
                        if (!Number.isInteger(Scope.proxyVerse.whitelist[flag].failures[proxy]))
                            Scope.proxyVerse.whitelist[flag].failures[proxy] = 0;
                        ++Scope.proxyVerse.whitelist[flag].failures[proxy];
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
                        j.proxy in Scope.proxyVerse.whitelist[flag].failures
                    ) {
                        delete Scope.proxyVerse.whitelist[flag].failures[j.proxy];
                    }
                });
                return successfulJump.commit;
            } else if (!isWhite && Scope.proxyVerse.listIte[flag] >= Scope.proxyVerse.list.length) {
                scrapProxy();
            }

            if (ite && !(ite % 15)) await wait(restTimer); // rest for some seconds
            return (await jump());
        };
        return (await jump());
    };
}