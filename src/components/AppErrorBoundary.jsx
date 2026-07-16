'use client';

import { Component } from 'react';
import { reportError } from '../lib/errorMonitor';

/**
 * AppErrorBoundary
 * React class-component error boundary.
 *
 * On first render error / hydration crash:
 *  - Reports via reportError()
 *  - Schedules an automatic reload after 2 s (only once)
 *  - Renders a safe fallback UI (all inline styles — works even if CSS fails to load)
 */
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
    };
    this._reloadTimer = null;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Report to server
    try {
      reportError({
        message: error?.message ?? String(error),
        stack: (error?.stack ?? '') + '\n\nComponent stack:\n' + (info?.componentStack ?? ''),
        type: 'react-error-boundary',
        url: typeof window !== 'undefined' ? window.location.href : '',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        timestamp: new Date().toISOString(),
      });
    } catch {
      // never throw from error handler
    }

    // Auto-reload once, 2 seconds after first catch
    if (this.state.retryCount === 0 && typeof window !== 'undefined') {
      this._reloadTimer = setTimeout(() => {
        window.location.reload();
      }, 2000);
      this.setState({ retryCount: 1 });
    }
  }

  componentWillUnmount() {
    if (this._reloadTimer) clearTimeout(this._reloadTimer);
  }

  handleReload() {
    if (this._reloadTimer) clearTimeout(this._reloadTimer);
    window.location.reload();
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const errorMsg = this.state.error?.message ?? 'An unexpected error occurred.';

    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#0b0b0d',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Helvetica Neue', Arial, sans-serif",
          color: '#e5e7eb',
          padding: '24px 16px',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        {/* Brand */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '48px', marginBottom: '8px' }}>♠</div>
          <div
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: '#c9b075', // gold
              letterSpacing: '0.5px',
            }}
          >
            PokerVsPlayer
          </div>
        </div>

        {/* Heading */}
        <h1
          style={{
            fontSize: '18px',
            fontWeight: 600,
            color: '#f3f4f6',
            margin: '0 0 12px',
          }}
        >
          Something went wrong
        </h1>

        {/* Error detail */}
        <p
          style={{
            fontSize: '12px',
            color: '#9ca3af',
            maxWidth: '320px',
            margin: '0 auto 28px',
            wordBreak: 'break-word',
          }}
        >
          {errorMsg}
        </p>

        {/* Reload button */}
        <button
          onClick={() => this.handleReload()}
          style={{
            backgroundColor: '#c9b075',
            color: '#0b0b0d',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 32px',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
            marginBottom: '20px',
            letterSpacing: '0.3px',
          }}
        >
          Reload
        </button>

        {/* Browser tip */}
        <p
          style={{
            fontSize: '12px',
            color: '#6b7280',
            maxWidth: '280px',
            margin: '0 auto',
          }}
        >
          Having trouble? Try opening in your main browser.
        </p>
      </div>
    );
  }
}
