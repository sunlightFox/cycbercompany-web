import { useEffect, useId, useRef, useState, type KeyboardEvent, type WheelEvent } from "react";
import { Minimize2, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStudioStore } from "../store/useStudioStore";

type DiagramState =
  | { status: "loading" }
  | { status: "ready"; svg: string; width: number }
  | { status: "error" };

let mermaidRenderQueue: Promise<unknown> = Promise.resolve();
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.15;

function queueMermaidRender<T>(render: () => Promise<T>) {
  const result = mermaidRenderQueue.then(render, render);
  mermaidRenderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cssToken(styles: CSSStyleDeclaration, name: string) {
  return styles.getPropertyValue(name).trim();
}

export default function MermaidDiagram({ chart }: { chart: string }) {
  const { t } = useTranslation();
  const theme = useStudioStore((state) => state.theme);
  const reactId = useId();
  const diagramId = useRef(`mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const manualZoomRef = useRef(false);
  const [state, setState] = useState<DiagramState>({ status: "loading" });
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateViewportWidth = () => {
      setViewportWidth(viewport.clientWidth);
    };

    updateViewportWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportWidth);
      return () => window.removeEventListener("resize", updateViewportWidth);
    }

    const observer = new ResizeObserver(() => {
      updateViewportWidth();
    });
    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    manualZoomRef.current = false;
    setScale(1);

    const timer = window.setTimeout(() => {
      void queueMermaidRender(async () => {
        const { default: mermaid } = await import("mermaid");
        const rootStyles = getComputedStyle(document.documentElement);
        const bodyStyles = getComputedStyle(document.body);

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "base",
          fontFamily: bodyStyles.fontFamily,
          themeVariables: {
            background: cssToken(rootStyles, "--surface"),
            primaryColor: cssToken(rootStyles, "--surface-muted"),
            primaryTextColor: cssToken(rootStyles, "--ink"),
            primaryBorderColor: cssToken(rootStyles, "--line-strong"),
            secondaryColor: cssToken(rootStyles, "--surface"),
            secondaryTextColor: cssToken(rootStyles, "--ink"),
            secondaryBorderColor: cssToken(rootStyles, "--line"),
            tertiaryColor: cssToken(rootStyles, "--hover"),
            tertiaryTextColor: cssToken(rootStyles, "--ink"),
            tertiaryBorderColor: cssToken(rootStyles, "--line"),
            lineColor: cssToken(rootStyles, "--ink-muted"),
            textColor: cssToken(rootStyles, "--ink"),
            mainBkg: cssToken(rootStyles, "--surface-muted"),
            nodeBorder: cssToken(rootStyles, "--line-strong"),
            clusterBkg: cssToken(rootStyles, "--surface"),
            clusterBorder: cssToken(rootStyles, "--line"),
            edgeLabelBackground: cssToken(rootStyles, "--surface"),
            actorBkg: cssToken(rootStyles, "--surface"),
            actorBorder: cssToken(rootStyles, "--line-strong"),
            actorTextColor: cssToken(rootStyles, "--ink"),
            actorLineColor: cssToken(rootStyles, "--line-strong"),
            signalColor: cssToken(rootStyles, "--ink"),
            signalTextColor: cssToken(rootStyles, "--ink"),
            labelBoxBkgColor: cssToken(rootStyles, "--surface"),
            labelBoxBorderColor: cssToken(rootStyles, "--line"),
            labelTextColor: cssToken(rootStyles, "--ink"),
            loopTextColor: cssToken(rootStyles, "--ink"),
            noteBkgColor: cssToken(rootStyles, "--surface-muted"),
            noteBorderColor: cssToken(rootStyles, "--line-strong"),
            noteTextColor: cssToken(rootStyles, "--ink"),
            activationBkgColor: cssToken(rootStyles, "--hover"),
            activationBorderColor: cssToken(rootStyles, "--line-strong"),
          },
          flowchart: { htmlLabels: false, useMaxWidth: false },
          sequence: { useMaxWidth: false },
        });

        const { svg } = await mermaid.render(diagramId.current, chart);
        const wrapper = document.createElement("div");
        wrapper.innerHTML = svg;
        const svgElement = wrapper.querySelector("svg");
        if (!svgElement) throw new Error("Mermaid returned no SVG");

        svgElement.setAttribute("role", "img");
        svgElement.setAttribute("aria-label", t("mermaidDiagram"));
        svgElement.setAttribute("focusable", "false");
        svgElement.setAttribute("tabindex", "-1");
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = t("mermaidDiagram");
        svgElement.prepend(title);

        const width = Number.parseFloat(svgElement.getAttribute("width") ?? "") || 0;

        if (!cancelled) setState({ status: "ready", svg: wrapper.innerHTML, width });
      }).catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chart, t, theme]);

  useEffect(() => {
    if (state.status !== "ready" || !viewportWidth || !state.width) return;

    const nextFit = clamp(viewportWidth / state.width, MIN_SCALE, 1);
    setFitScale(nextFit);

    if (!manualZoomRef.current) {
      setScale(nextFit);
    }
  }, [state, viewportWidth]);

  useEffect(() => {
    if (state.status !== "ready") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const svg = canvas.querySelector("svg");
    if (!svg) return;

    const width = state.width || svg.getBoundingClientRect().width || 0;
    if (!width) return;

    svg.style.display = "block";
    svg.style.maxWidth = "none";
    svg.style.height = "auto";
    svg.style.margin = "0 auto";
    svg.style.width = `${Math.max(1, width * scale)}px`;
  }, [state, scale]);

  const updateScale = (nextScale: number) => {
    manualZoomRef.current = true;
    setScale(clamp(nextScale, MIN_SCALE, MAX_SCALE));
  };

  const handleZoomIn = () => updateScale(scale + SCALE_STEP);
  const handleZoomOut = () => updateScale(scale - SCALE_STEP);
  const handleResetZoom = () => {
    manualZoomRef.current = false;
    setScale(fitScale);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    updateScale(scale + (event.deltaY > 0 ? -SCALE_STEP : SCALE_STEP));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      handleZoomIn();
      return;
    }

    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      handleZoomOut();
      return;
    }

    if (event.key === "0") {
      event.preventDefault();
      handleResetZoom();
    }
  };

  if (state.status === "error") {
    return (
      <section className="mermaid-diagram is-error" aria-label={t("mermaidDiagram")}>
        <div className="mermaid-diagram-toolbar">
          <strong className="mermaid-diagram-title">{t("mermaidDiagram")}</strong>
        </div>
        <div ref={viewportRef} className="mermaid-diagram-viewport">
          <div className="mermaid-diagram-message" role="alert">
            <span>{t("mermaidRenderFailed")}</span>
            <pre>
              <code className="language-mermaid">{chart}</code>
            </pre>
          </div>
        </div>
      </section>
    );
  }

  if (state.status === "loading") {
    return (
      <section className="mermaid-diagram is-loading" aria-busy="true" aria-label={t("mermaidDiagram")}>
        <div className="mermaid-diagram-toolbar">
          <strong className="mermaid-diagram-title">{t("mermaidDiagram")}</strong>
        </div>
        <div ref={viewportRef} className="mermaid-diagram-viewport">
          <div className="mermaid-diagram-status" role="status">{t("mermaidRendering")}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="mermaid-diagram" aria-label={t("mermaidDiagram")}>
      <div className="mermaid-diagram-toolbar">
        <strong className="mermaid-diagram-title">{t("mermaidDiagram")}</strong>
        <div className="mermaid-diagram-toolbar-actions">
          <span className="mermaid-diagram-scale" aria-hidden="true">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="icon-button"
            onClick={handleZoomOut}
            aria-label={t("zoomOut")}
            title={t("zoomOut")}
            disabled={scale <= MIN_SCALE}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={handleResetZoom}
            aria-label={t("fitDiagram")}
            title={t("fitDiagram")}
          >
            <Minimize2 size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={handleZoomIn}
            aria-label={t("zoomIn")}
            title={t("zoomIn")}
            disabled={scale >= MAX_SCALE}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="mermaid-diagram-viewport"
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <div ref={canvasRef} className="mermaid-diagram-canvas" dangerouslySetInnerHTML={{ __html: state.svg }} />
      </div>
    </section>
  );
}
