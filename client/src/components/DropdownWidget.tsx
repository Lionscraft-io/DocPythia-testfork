import React, { useState, useRef, useEffect } from 'react';
import { X, MessageCircle } from 'lucide-react';
import { Button } from './ui/button';

interface DropdownWidgetProps {
  title?: string;
  expertId?: string;
  domain?: string;
  theme?: 'light' | 'dark';
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  className?: string;
}

export function DropdownWidget({
  title = 'AI Assistant',
  expertId = 'default',
  domain = import.meta.env.VITE_WIDGET_DOMAIN || window.location.origin,
  theme = 'light',
  position = 'bottom-right',
  className = '',
}: DropdownWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const positionClasses = {
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
  };

  const widgetUrl = `${domain}/chat/${expertId}?theme=${theme}&embedded=true`;

  useEffect(() => {
    if (isOpen && iframeRef.current) {
      setIsLoading(true);
      const iframe = iframeRef.current;

      const handleLoad = () => {
        setIsLoading(false);
      };

      iframe.addEventListener('load', handleLoad);
      return () => iframe.removeEventListener('load', handleLoad);
    }
  }, [isOpen]);

  // Handle iframe messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from our domain
      if (!event.origin.includes(new URL(domain).hostname)) {
        return;
      }

      if (event.data.type === 'WIDGET_CLOSE') {
        setIsOpen(false);
      } else if (event.data.type === 'WIDGET_RESIZE') {
        // Handle dynamic resizing if needed - implementation pending
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [domain]);

  return (
    <>
      {/* Full-Screen Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
          <div
            className={`w-full h-full max-w-full max-h-full relative ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'}`}
          >
            {/* Header */}
            <div
              className={`flex items-center justify-between p-4 border-b ${theme === 'dark' ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}
            >
              <h2
                className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}
              >
                {title}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className={`h-8 w-8 p-0 ${theme === 'dark' ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Full-Screen Content */}
            <div className="relative w-full h-[calc(100vh-80px)]">
              {isLoading && (
                <div
                  className={`absolute inset-0 flex items-center justify-center ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className={`animate-spin rounded-full h-8 w-8 border-b-2 ${theme === 'dark' ? 'border-white' : 'border-gray-900'}`}
                    ></div>
                    <span
                      className={`text-lg ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}
                    >
                      Loading Chat...
                    </span>
                  </div>
                </div>
              )}
              <iframe
                ref={iframeRef}
                src={widgetUrl}
                className="w-full h-full border-0"
                title={`${title} Full Screen`}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      <div className={`fixed z-[9999] ${positionClasses[position]} ${className}`}>
        <Button
          onClick={() => setIsOpen(!isOpen)}
          className={`h-12 w-12 rounded-full shadow-lg transition-all duration-200 border-2 ${
            theme === 'dark'
              ? 'bg-gray-800 hover:bg-gray-700 text-white border-gray-600'
              : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-500'
          }`}
        >
          {isOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        </Button>
      </div>
    </>
  );
}
