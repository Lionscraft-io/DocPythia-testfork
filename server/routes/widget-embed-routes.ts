import { Router, Request, Response } from 'express';

const router = Router();

// Widget JavaScript library
router.get('/widget.js', (req: Request, res: Response) => {
  const domain = process.env.WIDGET_DOMAIN || 'http://localhost:3762';
  const projectName = process.env.PROJECT_NAME || 'DocPythia';
  const widgetNamespace = process.env.WIDGET_NAMESPACE || 'DocPythiaWidget';

  const widgetJs = `
(function() {
    'use strict';

    window.${widgetNamespace} = {
        init: function(options) {
            const config = {
                expertId: options.expertId || 'default',
                theme: options.theme || 'light',
                position: options.position || 'bottom-right',
                title: options.title || '${projectName} AI',
                domain: '${domain}',
                ...options
            };

            this.createWidget(config);
        },

        createWidget: function(config) {
            // Create widget container
            const widgetContainer = document.createElement('div');
            widgetContainer.id = 'docpythia-widget-container';
            widgetContainer.style.cssText = \`
                position: fixed;
                z-index: 10000;
                \${this.getPositionStyles(config.position)}
            \`;

            // Create toggle button
            const toggleButton = document.createElement('button');
            toggleButton.id = 'docpythia-widget-toggle';
            toggleButton.innerHTML = '💬';
            toggleButton.style.cssText = \`
                width: 60px;
                height: 60px;
                border-radius: 50%;
                border: none;
                background: #007bff;
                color: white;
                cursor: pointer;
                font-size: 24px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                transition: all 0.3s ease;
            \`;

            // Create widget iframe
            const widgetFrame = document.createElement('iframe');
            widgetFrame.id = 'docpythia-widget-frame';
            widgetFrame.src = \`\${config.domain}/widget/\${config.expertId}?theme=\${config.theme}&embedded=true\`;
            widgetFrame.style.cssText = \`
                width: 350px;
                height: 500px;
                border: none;
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.15);
                display: none;
                margin-bottom: 16px;
                background: white;
            \`;

            let isOpen = false;

            toggleButton.addEventListener('click', function() {
                isOpen = !isOpen;
                widgetFrame.style.display = isOpen ? 'block' : 'none';
                toggleButton.innerHTML = isOpen ? '✕' : '💬';
            });

            // Add to DOM
            widgetContainer.appendChild(widgetFrame);
            widgetContainer.appendChild(toggleButton);
            document.body.appendChild(widgetContainer);

            // Handle messages from iframe
            window.addEventListener('message', function(event) {
                if (event.origin !== config.domain) return;

                if (event.data.type === 'WIDGET_CLOSE') {
                    isOpen = false;
                    widgetFrame.style.display = 'none';
                    toggleButton.innerHTML = '💬';
                }
            });
        },

        getPositionStyles: function(position) {
            const styles = {
                'bottom-right': 'bottom: 20px; right: 20px;',
                'bottom-left': 'bottom: 20px; left: 20px;',
                'top-right': 'top: 20px; right: 20px;',
                'top-left': 'top: 20px; left: 20px;'
            };
            return styles[position] || styles['bottom-right'];
        }
    };

    // Auto-init if data attributes are present
    document.addEventListener('DOMContentLoaded', function() {
        const autoInit = document.querySelector('[data-docpythia-widget]');
        if (autoInit) {
            const config = {
                expertId: autoInit.getAttribute('data-expert-id') || 'default',
                theme: autoInit.getAttribute('data-theme') || 'light',
                position: autoInit.getAttribute('data-position') || 'bottom-right',
                title: autoInit.getAttribute('data-title') || '${projectName} AI'
            };
            window.${widgetNamespace}.init(config);
        }
    });
})();`;

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
  res.send(widgetJs);
});

// Widget demo page
router.get('/widget-demo', (req: Request, res: Response) => {
  const domain = process.env.WIDGET_DOMAIN || 'http://localhost:3762';
  const projectName = process.env.PROJECT_NAME || 'DocPythia';
  const widgetNamespace = process.env.WIDGET_NAMESPACE || 'DocPythiaWidget';

  const demoHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${projectName} Widget Demo</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 40px;
            background: #f8f9fa;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        h1 { color: #333; margin-bottom: 30px; }
        h2 { color: #555; margin-top: 30px; }
        code {
            background: #f1f3f4;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
        }
        .code-block {
            background: #1a1a1a;
            color: #e1e1e1;
            padding: 20px;
            border-radius: 8px;
            overflow-x: auto;
            margin: 16px 0;
        }
        .demo-button {
            background: #007bff;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            margin: 8px 8px 8px 0;
        }
        .demo-button:hover {
            background: #0056b3;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 ${projectName} AI Widget Demo</h1>

        <p>This page demonstrates the ${projectName} AI widget integration. The widget provides AI-powered documentation assistance and can be easily embedded on any website.</p>

        <h2>🚀 Quick Start</h2>
        <p>Add this script to your website to enable the widget:</p>

        <div class="code-block">
&lt;script src="${domain}/widget.js"&gt;&lt;/script&gt;
&lt;div data-docpythia-widget data-expert-id="default" data-theme="light"&gt;&lt;/div&gt;
        </div>

        <h2>📋 Manual Integration</h2>
        <div class="code-block">
&lt;script src="${domain}/widget.js"&gt;&lt;/script&gt;
&lt;script&gt;
  ${widgetNamespace}.init({
    expertId: 'default',
    theme: 'light',
    position: 'bottom-right',
    title: '${projectName} Help'
  });
&lt;/script&gt;
        </div>

        <h2>🎨 Demo Controls</h2>
        <button class="demo-button" onclick="initWidget('default', 'light', 'bottom-right')">
            Light Theme (Bottom Right)
        </button>
        <button class="demo-button" onclick="initWidget('default', 'dark', 'bottom-left')">
            Dark Theme (Bottom Left)
        </button>
        <button class="demo-button" onclick="initWidget('default', 'light', 'top-right')">
            Top Right Position
        </button>
        <button class="demo-button" onclick="removeWidget()">
            Remove Widget
        </button>

        <h2>⚙️ Configuration Options</h2>
        <ul>
            <li><code>expertId</code> - The expert/assistant ID (default: 'default')</li>
            <li><code>theme</code> - 'light' or 'dark' (default: 'light')</li>
            <li><code>position</code> - 'bottom-right', 'bottom-left', 'top-right', 'top-left'</li>
            <li><code>title</code> - Widget title (default: '${projectName} AI')</li>
        </ul>

        <h2>🔗 Direct Widget URL</h2>
        <p>You can also embed the widget directly using an iframe:</p>
        <div class="code-block">
&lt;iframe
  src="${domain}/widget/default?theme=light&embedded=true"
  width="350"
  height="500"
  frameborder="0"
&gt;&lt;/iframe&gt;
        </div>

        <h2>🛡️ Security</h2>
        <p>The widget is designed with security in mind:</p>
        <ul>
            <li>Sandboxed iframe environment</li>
            <li>CORS protection</li>
            <li>Content Security Policy headers</li>
            <li>No access to parent page data</li>
        </ul>
    </div>

    <script src="${domain}/widget.js"></script>
    <script>
        const widgetNamespace = '${widgetNamespace}';
        const projectName = '${projectName}';

        function initWidget(expertId, theme, position) {
            removeWidget();
            setTimeout(() => {
                window[widgetNamespace].init({
                    expertId: expertId,
                    theme: theme,
                    position: position,
                    title: projectName + ' Help Demo'
                });
            }, 100);
        }

        function removeWidget() {
            const existing = document.getElementById('docpythia-widget-container');
            if (existing) {
                existing.remove();
            }
        }

        // Initialize with default settings
        document.addEventListener('DOMContentLoaded', function() {
            initWidget('default', 'light', 'bottom-right');
        });
    </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(demoHtml);
});

export default router;
