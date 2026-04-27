"use client";

/**
 * ErrorBoundary · 通用 React class 错误边界 (2026-04-27)
 *
 * Why this exists:大型详情面板里 11 个 view 子组件(CsvView / DocxView /
 * PdfView 等)+ markdown / drawio / xlsx 解析逻辑,任意一个抛出未捕获的
 * 渲染错误都会让整个面板黑屏 — 用户看到的是"白屏 + 控制台 stack",而
 * 不是友好的"渲染失败,可下载原文件"降级。
 *
 * Pattern: 标准 class component error boundary(React 不支持 hook 形式)。
 * 调用方传 fallback 渲染器,收到 (error, reset) 自定义降级 UI。
 *
 * 业界对照:Sentry React 文档推荐做法 / Linear / GitHub 文件预览失败时
 * 的"无法渲染此文件 · 下载查看"模式。
 *
 * 不要在 root 包,只在"局部失败不该让整个 app 崩"的边界节点包(详情面
 * 板 / dashboard widget / drawer / dialog)。
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

type FallbackRender = (args: { error: Error; reset: () => void }) => ReactNode;

type Props = {
  /** Render the fallback UI when the boundary catches an error. */
  fallback: FallbackRender;
  /** Optional logger hook — Sentry / console / etc. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** When this key changes, the boundary resets — useful for "switching to a
   *  different artifact resets the previous failure". */
  resetKey?: string | number;
  children: ReactNode;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("[ErrorBoundary]", error, info);
    }
  }

  override componentDidUpdate(prev: Props): void {
    if (
      this.state.error !== null &&
      prev.resetKey !== this.props.resetKey
    ) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }
    return this.props.children;
  }
}
