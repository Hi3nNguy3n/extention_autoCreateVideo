import { useState, useRef, useEffect } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type SceneStatus = 'pending' | 'running' | 'success' | 'failed';

interface Scene {
  prompt: string;
  status: SceneStatus;
  videoUrl?: string;
  videoData?: string;
}

interface Config {
  scriptModel: string;
  videoModel: string;
  ratio: string;
  speed: string;
  geminiKey: string;
  autoDownload: boolean;
  maxRetries: number;
}

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'error' | 'success';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'automation' | 'settings' | 'logs'>('automation');
  const [loading, setLoading] = useState(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [progress, setProgress] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [config, setConfig] = useState<Config>({
    scriptModel: localStorage.getItem('fpoly_script_model') || 'gemini-2.5-flash-lite',
    videoModel: localStorage.getItem('fpoly_video_model') || 'Veo 3.1 Lite',
    ratio: localStorage.getItem('fpoly_ratio') || '9:16',
    speed: localStorage.getItem('fpoly_speed') || '1x',
    geminiKey: localStorage.getItem('gemini_key') || '',
    autoDownload: localStorage.getItem('fpoly_auto_download') === 'true',
    maxRetries: parseInt(localStorage.getItem('fpoly_max_retries') || '3'),
  });
  
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const ffmpegRef = useRef(new FFmpeg());

  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const entry: LogEntry = {
      time: new Date().toLocaleTimeString(),
      message,
      type
    };
    // Đảo ngược log: mới nhất ở trên cùng
    setLogs(prev => [entry, ...prev].slice(0, 50));
  };

  const updateConfig = (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    Object.entries(updates).forEach(([key, value]) => {
      localStorage.setItem(key === 'geminiKey' ? 'gemini_key' : `fpoly_${key.replace(/([A-Z])/g, "_$1").toLowerCase()}`, String(value));
    });
  };

  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'PROGRESS_UPDATE') {
        const idx = message.scene - 1;
        setCurrentSceneIndex(message.scene);
        setScenes(prev => {
          const next = [...prev];
          if (next[idx]) {
            next[idx].status = 'success';
            next[idx].videoUrl = message.videoUrl;
            next[idx].videoData = message.videoData;
          }
          return next;
        });
        addLog(`✅ Hoàn thành Cảnh ${message.scene}`, 'success');
        setProgress(`Tiến độ: ${message.scene}/${scenes.length}`);
      } else if (message.type === 'GENERATION_FINISHED') {
        setCurrentSceneIndex(null);
        if (message.videoDataList.length === scenes.length) {
          setProgress("⚙️ Đang xử lý FFmpeg...");
          addLog("Dữ liệu video đã sẵn sàng. Đang khởi tạo bộ ghép...", 'info');
          mergeVideos(message.videoDataList);
        } else {
          setProgress(`⚠️ Lỗi: Chỉ có ${message.videoDataList.length}/${scenes.length} video`);
        }
      } else if (message.type === 'SCENE_FAILED') {
        setScenes(prev => {
          const next = [...prev];
          if (currentSceneIndex !== null) next[currentSceneIndex - 1].status = 'failed';
          return next;
        });
        addLog(`❌ Lỗi Robot: ${message.error}`, 'error');
        setProgress(`Lỗi: ${message.error}`);
        setCurrentSceneIndex(null);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, [scenes.length, currentSceneIndex]);

  const mergeVideos = async (base64List: string[]) => {
    try {
      const ffmpeg = ffmpegRef.current;
      
      if (!ffmpeg.loaded) {
        addLog("⏳ Đang tải nhân xử lý video (Core)...", 'info');
        const baseURL = chrome.runtime.getURL('ffmpeg/');
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}ffmpeg-core.wasm`, 'application/wasm'),
        });
        addLog("✅ Nhân FFmpeg đã sẵn sàng.", 'success');
      }

      addLog(`📦 Đang chuẩn bị ${base64List.length} tệp video...`, 'info');
      for (let i = 0; i < base64List.length; i++) {
        const res = await fetch(base64List[i]);
        const blob = await res.blob();
        await ffmpeg.writeFile(`v${i}.mp4`, await fetchFile(blob));
        addLog(`- Đã nạp Cảnh ${i + 1}`, 'info');
      }

      const listContent = base64List.map((_, i) => `file 'v${i}.mp4'`).join('\n');
      await ffmpeg.writeFile('list.txt', listContent);
      
      addLog("🎬 Đang ghép phim (Vui lòng đợi)...", 'info');
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'final.mp4']);

      addLog("💾 Đang xuất file thành phẩm...", 'info');
      const data = await ffmpeg.readFile('final.mp4');
      const url = URL.createObjectURL(new Blob([(data as any).buffer], { type: 'video/mp4' }));
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `fpoly_pro_movie_${Date.now()}.mp4`;
      a.click();
      
      addLog("🏆 XUẤT PHIM THÀNH CÔNG!", 'success');
      setProgress("Hoàn tất!");
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      addLog(`❌ Lỗi FFmpeg: ${errMsg}`, 'error');
      setProgress("Lỗi ghép video. Bạn hãy tải lẻ từng cảnh!");
      console.error("FFmpeg Error:", err);
    }
  };

  const startAutomation = () => {
    if (scenes.length === 0) return;
    setScenes(prev => prev.map(s => ({ ...s, status: 'pending' })));
    setCurrentSceneIndex(1);
    addLog("🚀 Hệ thống Elite bắt đầu xuất kích...", 'info');
    const jobId = Date.now().toString();
    chrome.runtime.sendMessage({ 
      type: 'START_GENERATION', 
      jobId: jobId,
      scripts: scenes.map(s => s.prompt),
      config: { model: config.videoModel, ratio: config.ratio, speed: config.speed, maxRetries: config.maxRetries }
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    addLog(`📄 Đang đọc dữ liệu: ${file.name}`, 'info');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument(arrayBuffer).promise;
      let rawText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        rawText += textContent.items.map((item: any) => item.str).join(" ");
      }
      
      const genAI = new GoogleGenerativeAI(config.geminiKey);
      const model = genAI.getGenerativeModel({ model: config.scriptModel });
      const systemPrompt = `You are a world-class Cinematic Director. Transform this text into 5 ultra-detailed cinematic prompts (40-70 words each). Describe camera, lighting, textures, and motion. Format: Prompt 1 ||| Prompt 2 ||| ... Text: ${rawText.substring(0, 4000)}`;

      const result = await model.generateContent(systemPrompt);
      const text = (await result.response).text();
      const lines = text.split('|||').map(s => s.trim())
        .map(s => s.replace(/^(CẢNH|SCENE|Cảnh|Scene|Mô tả|Hành động)\s*\d*[:\-.]*/gi, ''))
        .filter(s => s.length > 5).slice(0, 5);

      setScenes(lines.map(p => ({ prompt: p, status: 'pending' })));
      addLog("✨ Đã biên soạn kịch bản Elite.", 'success');
    } catch (error: any) {
      addLog(`❌ Lỗi AI: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#020617] text-slate-100 overflow-hidden font-sans">
      <header className="p-4 pt-6 flex items-center justify-between border-b border-white/5 bg-[#020617]/90 backdrop-blur-2xl z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 amber-gradient rounded-xl flex items-center justify-center animate-float"><span className="text-xl">🎬</span></div>
          <div>
            <h1 className="text-lg font-black uppercase amber-text-gradient leading-none tracking-tighter">Fpoly Pro</h1>
            <p className="text-[8px] text-slate-500 uppercase font-black mt-1 tracking-widest">Elite Robot v4.5</p>
          </div>
        </div>
        <div className="flex bg-white/5 p-1 rounded-xl">
          {(['automation', 'settings', 'logs'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3 py-1.5 text-[9px] font-black rounded-lg uppercase transition-all ${activeTab === tab ? 'bg-amber-500 text-black' : 'text-slate-500'}`}>{tab}</button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-5 custom-scrollbar space-y-6">
        {activeTab === 'settings' && (
          <div className="cyber-panel p-5 rounded-2xl space-y-5 border border-white/5 animate-in slide-in-from-right-4">
             <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <h2 className="text-[10px] font-black uppercase text-slate-400">Configuration</h2>
                <button onClick={() => {
                  setTestStatus('testing');
                  chrome.runtime.sendMessage({ type: 'PING' }, (r) => setTestStatus(r ? 'success' : 'error'));
                }} className={`px-3 py-1 rounded-full text-[8px] font-black uppercase ${testStatus === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-slate-500'}`}>
                   {testStatus === 'idle' ? '📡 Test' : testStatus === 'testing' ? '...' : testStatus === 'success' ? 'Ready' : 'Fail'}
                </button>
             </div>
             <div className="space-y-4">
                <input type="password" value={config.geminiKey} onChange={(e) => updateConfig({ geminiKey: e.target.value })} className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-xs outline-none focus:border-amber-500 font-mono" placeholder="Gemini API Key" />
                <div className="grid grid-cols-2 gap-4">
                   <input type="text" value={config.scriptModel} onChange={(e) => updateConfig({ scriptModel: e.target.value })} className="bg-black/40 border border-white/5 rounded-xl p-3 text-[10px] outline-none font-mono" />
                   <input type="text" value={config.videoModel} onChange={(e) => updateConfig({ videoModel: e.target.value })} className="bg-black/40 border border-white/5 rounded-xl p-3 text-[10px] outline-none font-mono" />
                </div>
             </div>
          </div>
        )}

        {activeTab === 'automation' && (
          <div className="space-y-6 animate-in slide-in-from-left-4">
            <label className={`block border-2 border-dashed border-white/5 rounded-3xl text-center p-10 hover:border-amber-500/50 cursor-pointer transition-all ${loading ? 'opacity-50' : ''}`}>
              <span className="text-4xl block mb-2">📂</span>
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{loading ? 'Processing...' : 'Import PDF Script'}</p>
              <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} disabled={loading} />
            </label>

            <div className="grid gap-3 pb-32">
              {scenes.map((scene, idx) => (
                <div key={idx} className={`scene-card cyber-panel p-4 rounded-xl border relative ${scene.status === 'running' ? 'running' : scene.status === 'success' ? 'success' : 'border-white/5'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[9px] font-black text-slate-500">SCENE {idx + 1}</span>
                    <div className="flex gap-2">
                      {scene.status === 'success' && (
                        <button onClick={() => {
                          const a = document.createElement('a');
                          a.href = scene.videoData!;
                          a.download = `scene_${idx + 1}.mp4`;
                          a.click();
                        }} className="text-emerald-500 hover:text-emerald-400 p-1 bg-emerald-500/10 rounded">
                           <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                        </button>
                      )}
                      <button onClick={() => setScenes(scenes.filter((_, i) => i !== idx))} className="text-slate-600 hover:text-red-500 px-1">×</button>
                    </div>
                  </div>
                  <textarea className="w-full bg-transparent border-none text-[11px] p-0 focus:ring-0 resize-none h-12 text-slate-400 font-medium" value={scene.prompt} readOnly />
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="cyber-panel p-5 rounded-2xl font-mono text-[9px] min-h-[400px] border border-white/5">
            {logs.map((log, i) => (
              <div key={i} className="mb-2 flex gap-3 border-b border-white/5 pb-2">
                <span className="text-slate-600 shrink-0">[{log.time}]</span>
                <span className={log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-400'}>{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#020617] to-transparent z-30">
        <div className="max-w-md mx-auto space-y-4">
          {progress && (
            <div className="glass p-3 rounded-xl border-l-2 border-amber-500 flex items-center gap-3 animate-in slide-in-from-bottom-2">
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
              <p className="text-[10px] font-black text-amber-500 uppercase tracking-tighter">{progress}</p>
            </div>
          )}
          {activeTab === 'automation' && scenes.length > 0 && (
            <button 
              onClick={startAutomation} 
              disabled={!!currentSceneIndex}
              className="w-full py-4 amber-gradient glow-btn text-black rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl disabled:opacity-30 transition-all"
            >
              {currentSceneIndex ? 'Robot Processing' : '🚀 Launch Elite Robot'}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
