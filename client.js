// dsh-money-meter — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-money-meter/client.js and
// executed through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with
// require() resolved against the shell's module table — the same shape the
// shipped ui-* bundles emit.
//
// It registers one entry in the composer dock (`conversation.composer.dock`),
// which is the row that already carries the turn/step and token pills. The
// meter renders in that row's leftmost position without occupying a row of its
// own, and its detail panel opens upward as an overlay, so neither mounting nor
// clicking it moves the composer.
//
// All Host data arrives over the /dsh-money-meter channel.

window.__ModuleLoader__.load({
	id: "dsh-money-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		//#region dsh-money-meter: constants
		/** Loopback channel owned by the Host half. */
		const RPC_CHANNEL = "/dsh-money-meter";
		/** Snapshot poll period while the conversation is open. */
		const POLL_MS = 5000;
		/** Balance at or below this reads as a warning. */
		const LOW_BALANCE = 10;
		/** Style tag identity, so a reload replaces rather than stacks. */
		const STYLE_ID = "dsh-money-meter";

		const CSS = `
.dsh-mm{position:relative;box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,867px);height:0;margin:0 auto;padding:0;flex:none;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}
.dsh-mm-pill{position:absolute;left:calc(var(--dsh-composer-side-clearance,16px) + 16px);bottom:0;box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;border-radius:24px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}
.dsh-mm-pill svg{flex:none;width:14px;height:14px}
.dsh-mm-pill:hover,.dsh-mm-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dsh-mm-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}
.dsh-mm-v{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dsh-mm-v.warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-mm-v.err{color:var(--dsw-alias-state-error-primary)}
.dsh-mm-panel{position:absolute;left:calc(var(--dsh-composer-side-clearance,16px) + 16px);bottom:34px;z-index:1100;box-sizing:border-box;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:16px;font-size:12px;line-height:18px}
.dsh-mm-title{color:var(--dsw-alias-label-primary);align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}
.dsh-mm-titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}
.dsh-mm-titleLabel svg{flex:none;width:14px;height:14px}
.dsh-mm-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}
.dsh-mm-details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}
.dsh-mm-details dt,.dsh-mm-details dd{min-width:0;margin:0}
.dsh-mm-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}
.dsh-mm-error{margin-top:10px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.dsh-mm-btn{color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:8px;padding:2px 6px;font:inherit;font-size:12px;cursor:pointer}
.dsh-mm-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
/*
 * The stats row sits directly before this plugin's root. Reserve exactly the
 * width this pill reports (published as --dsh-mm-reserve from the component),
 * so the meter lands on that row's left edge and the two official pills slide
 * right by the same amount instead of being overlapped.
 */
[data-composer-stats]:has(+ .dsh-mm){justify-content:flex-start;padding-left:calc(var(--dsh-composer-side-clearance,16px) + 16px + var(--dsh-mm-reserve,200px))}
`;
		//#endregion

		//#region dsh-money-meter: stylesheet
		/**
		 * Insert this package's stylesheet, replacing any tag left by a previous
		 * generation of the same plugin.
		 * @param css - stylesheet text.
		 * @returns the disposer that removes the tag.
		 */
		function insertStyles(css) {
			const existing = document.querySelector("style[data-plugin=" + JSON.stringify(STYLE_ID) + "]");
			if (existing !== null) existing.remove();
			const tag = document.createElement("style");
			tag.dataset.plugin = STYLE_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		//#endregion

		//#region dsh-money-meter: formatting
		/** Currency symbol for one API currency code. */
		function symbolOf(currency) {
			return currency === "USD" ? "$" : "¥";
		}

		/** Money with enough precision to make sub-cent session costs readable. */
		function fmtMoney(value, symbol) {
			if (value === null || value === undefined || !isFinite(value)) return "—";
			const magnitude = Math.abs(value);
			if (magnitude >= 1) return symbol + value.toFixed(2);
			if (magnitude >= 0.01) return symbol + value.toFixed(4);
			return symbol + value.toFixed(5);
		}

		/** Token counts in the compact form the neighbouring pills use. */
		function fmtTokens(value) {
			if (!value) return "0";
			if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
			if (value >= 1000) return (value / 1000).toFixed(1) + "k";
			return String(value);
		}

		/** Local wall-clock time of the last balance read. */
		function fmtTime(timestamp) {
			if (!timestamp) return "—";
			const date = new Date(timestamp);
			const pad = (part) => (part < 10 ? "0" + part : String(part));
			return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
		}
		//#endregion

		//#region dsh-money-meter: view
		/** The ¥ glyph, at the same 14×14 optical size as the official pill icons. */
		function YuanIcon() {
			return React.createElement(
				"svg",
				{
					viewBox: "0 0 16 16",
					width: 14,
					height: 14,
					"aria-hidden": true,
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.4,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				},
				React.createElement("path", { key: "a", d: "M4.6 3.4 8 8l3.4-4.6" }),
				React.createElement("path", { key: "b", d: "M8 8v4.9" }),
				React.createElement("path", { key: "c", d: "M5.6 9.6h4.8" }),
				React.createElement("path", { key: "d", d: "M5.6 11.6h4.8" }),
			);
		}

		/** One definition row of the detail panel's grid. */
		function detailRow(key, label, value) {
			return React.createElement(
				React.Fragment,
				{ key: key },
				React.createElement("dt", null, label),
				React.createElement("dd", null, value),
			);
		}

		/**
		 * The composer-dock meter.
		 * @param props - Slot props; `sessionId` scopes the session row.
		 */
		function MoneyMeter(props) {
			const connection = props.connection;
			const sessionId = props.sessionId === undefined || props.sessionId === null ? "" : String(props.sessionId);
			const [snapshot, setSnapshot] = React.useState(null);
			const [open, setOpen] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);

			React.useEffect(() => {
				let alive = true;
				const pull = () => {
					connection.rpc
						.call(RPC_CHANNEL, "snapshot", { sessionId })
						.then((result) => {
							if (!alive) return;
							if (!result.ok) throw new Error(result.error.message);
							setSnapshot(result.value);
							setError(null);
						})
						.catch((cause) => {
							if (alive) setError(String((cause && cause.message) || cause));
						});
				};
				pull();
				const timer = setInterval(pull, POLL_MS);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [connection, sessionId]);

			React.useEffect(() => {
				// Publish this pill's width so the stats row reserves exactly the
				// space it needs. A fixed constant would drift with the numbers.
				try {
					const pill = document.querySelector(".dsh-mm-pill");
					const width = pill === null ? 0 : Math.ceil(pill.getBoundingClientRect().width);
					if (width > 0) {
						document.documentElement.style.setProperty("--dsh-mm-reserve", width + 14 + "px");
					}
				} catch {
					/* measurement is cosmetic */
				}
			}, [snapshot, open]);

			const refresh = () => {
				setBusy(true);
				connection.rpc
					.call(RPC_CHANNEL, "refresh", { sessionId })
					.then((result) => {
						if (!result.ok) throw new Error(result.error.message);
						setSnapshot(result.value);
						setError(null);
					})
					.catch((cause) => setError(String((cause && cause.message) || cause)))
					.finally(() => setBusy(false));
			};

			const balance = snapshot && snapshot.balance ? snapshot.balance : null;
			const session = snapshot && snapshot.session ? snapshot.session : null;
			const resolved = balance !== null && balance.status === "ok";
			const remaining = resolved ? balance.total : null;
			const symbol = symbolOf(balance ? balance.currency : "CNY");
			const low = remaining !== null && remaining <= LOW_BALANCE;
			const failed = balance !== null && balance.status === "error";

			const pill = React.createElement(
				"button",
				{
					type: "button",
					className: "dsh-mm-pill",
					"aria-haspopup": "dialog",
					"aria-expanded": open,
					onClick: () => setOpen(!open),
				},
				React.createElement(YuanIcon, { key: "icon" }),
				React.createElement("span", { key: "spent-label" }, "消耗 "),
				React.createElement("span", { className: "dsh-mm-v", key: "spent" }, fmtMoney(session ? session.cost : 0, symbol)),
				React.createElement("span", { className: "dsh-mm-sep", "aria-hidden": true, key: "sep" }, "·"),
				React.createElement("span", { key: "left-label" }, "剩余 "),
				React.createElement(
					"span",
					{ className: "dsh-mm-v" + (low ? " warn" : "") + (failed ? " err" : ""), key: "left" },
					remaining === null
						? balance !== null && balance.status === "loading"
							? "查询中…"
							: "—"
						: symbol + remaining.toFixed(2),
				),
			);

			const children = [pill];

			if (open) {
				const rows = [];
				rows.push(detailRow("session", "本次会话消耗", fmtMoney(session ? session.cost : 0, "¥") + " · " + (session ? session.calls : 0) + " 次"));
				rows.push(detailRow("today", "今日消耗", fmtMoney(snapshot && snapshot.today ? snapshot.today.cost : 0, "¥") + " · " + (snapshot && snapshot.today ? snapshot.today.calls : 0) + " 次"));
				rows.push(detailRow("life", "运行以来", fmtMoney(snapshot && snapshot.life ? snapshot.life.cost : 0, "¥") + " · " + (snapshot && snapshot.life ? snapshot.life.calls : 0) + " 次"));
				if (session) {
					rows.push(detailRow("input", "输入 tokens", fmtTokens(session.input)));
					rows.push(detailRow("output", "输出 tokens", fmtTokens(session.output)));
					rows.push(detailRow("cache", "缓存读 tokens", fmtTokens(session.cacheRead)));
				}
				rows.push(
					detailRow(
						"balance",
						"账户余额",
						resolved ? symbol + remaining.toFixed(2) + " " + (balance.currency || "") : balance !== null && balance.status === "loading" ? "查询中…" : "不可用",
					),
				);
				if (resolved && balance.at) rows.push(detailRow("updated", "余额更新", fmtTime(balance.at)));

				const models = (snapshot && snapshot.models ? snapshot.models : []).slice();
				models.sort((left, right) => right.cost - left.cost);
				for (let index = 0; index < models.length && index < 5; index += 1) {
					const row = models[index];
					rows.push(detailRow("model-" + row.key, row.model + " × " + row.calls, fmtMoney(row.cost, "¥")));
				}

				children.push(
					React.createElement(
						"div",
						{ className: "dsh-mm-panel", role: "dialog", "aria-label": "消耗与余额", key: "panel" },
						React.createElement(
							"div",
							{ className: "dsh-mm-title" },
							React.createElement("span", { className: "dsh-mm-titleLabel" }, React.createElement(YuanIcon), "消耗与余额"),
							React.createElement("button", { type: "button", className: "dsh-mm-btn", onClick: refresh }, busy ? "刷新中…" : "刷新余额"),
						),
						React.createElement("div", { className: "dsh-mm-rule", "aria-hidden": true }),
						React.createElement("dl", { className: "dsh-mm-details" }, rows),
						error || (failed && balance.error)
							? React.createElement("div", { className: "dsh-mm-error" }, "余额查询失败：" + (error || balance.error))
							: null,
					),
				);
			}

			return React.createElement("div", { className: "dsh-mm" }, children);
		}
		//#endregion

		//#region dsh-money-meter: plugin entry
		/** Required services (cordis fiber inject). */
		const inject = ["slots", "connection"];

		/**
		 * Register the stylesheet and the composer-dock meter.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => insertStyles(CSS), "dsh-money-meter: stylesheet");
			ctx.effect(
				() => () => {
					try {
						document.documentElement.style.removeProperty("--dsh-mm-reserve");
					} catch {
						/* nothing to undo */
					}
				},
				"dsh-money-meter: reserve variable",
			);

			ctx.inject(["slots", "connection"], (scope) => {
				const connection = scope.get("connection");
				scope.slots.inject("conversation.composer.dock", () =>
					scope.slots.register(
						{ name: "conversation.composer.dock", id: "money-meter", order: 20, label: "消耗/余额" },
						(props) => React.createElement(MoneyMeter, { connection, sessionId: props && props.sessionId }),
					),
				);
			});
		}
		//#endregion

		exports.MoneyMeter = MoneyMeter;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
