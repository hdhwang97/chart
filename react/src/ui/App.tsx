import React, { useState, useEffect } from 'react';

export default function App() {
  const [jsonInput, setJsonInput] = useState(`{
  "type": "bar",
  "mode": "percent",
  "values": [15, 35, 60, 80]
}`);
  const [log, setLog] = useState('');
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    // code.js로부터 메시지 수신
    window.onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;
      if (msg.type === 'log') {
        setLog(msg.message);
        setIsError(!msg.ok);
      }
    };
  }, []);

  const handleApply = () => {
    parent.postMessage(
      {
        pluginMessage: {
          type: 'apply',
          payload: jsonInput,
        },
      },
      '*',
    );
  };

  return (
    <div className="p-3 font-sans text-xs text-gray-900">
      <h1 className="text-sm font-semibold mb-2">Chart</h1>

      <div className="text-[11px] text-gray-500 mb-1">
        예)
        <br />
        {`{ "type": "bar", "mode": "percent", "values": [10, 25, 18] }`}
        <br />
        {`{ "type": "stackedBar", "mode": "raw", "values": [[10,20,15],[5,30,10]] }`}
        <br />
        {`{ "type": "line", "mode": "raw", "values": [99,12,27,48] }`}
      </div>

      <textarea
        value={jsonInput}
        onChange={(e) => setJsonInput(e.target.value)}
        className="w-full h-40 box-border font-mono text-[11px] p-1.5 border border-gray-300 rounded resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <button
        type="button"
        onClick={handleApply}
        className="mt-2 px-2.5 py-1.5 text-xs rounded border border-gray-600 bg-gray-900 text-white cursor-pointer hover:bg-gray-800 transition-colors"
      >
        Apply to Selected Graph
      </button>

      {log && (
        <div
          className={`mt-2.5 p-2 rounded text-[11px] font-mono whitespace-pre-wrap max-h-[150px] overflow-auto ${
            isError
              ? 'border border-red-300 bg-red-50'
              : 'border border-gray-200 bg-gray-50'
          }`}
        >
          {log}
        </div>
      )}
    </div>
  );
}
