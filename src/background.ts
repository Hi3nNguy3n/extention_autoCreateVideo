/// <reference types="chrome" />

interface AutomationState {
  activeJobId: string | null;
  activeScripts: string[];
  currentSceneIndex: number;
  generatedVideoUrls: string[];
  generatedVideoData: string[]; // Thêm lưu dữ liệu Base64
  lastFrameBase64: string | null;
  retryCount: number;
  activeConfig: any | null;
  targetTabId: number | undefined;
}

let state: AutomationState = {
  activeJobId: null,
  activeScripts: [],
  currentSceneIndex: 0,
  generatedVideoUrls: [],
  generatedVideoData: [],
  lastFrameBase64: null,
  retryCount: 0,
  activeConfig: null,
  targetTabId: undefined
};

// Khôi phục trạng thái
chrome.storage.local.get(['fpoly_automation_state'], (result) => {
  const savedState = result.fpoly_automation_state as Partial<AutomationState> | undefined;
  if (savedState) {
    state = { ...state, ...savedState };
    console.log("💾 Khôi phục Job:", state.activeJobId);
  }
});

function saveState() {
  chrome.storage.local.set({ fpoly_automation_state: state });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'next_scene_alarm' || alarm.name === 'retry_scene_alarm') {
    startNextScene();
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

function startNextScene() {
  chrome.tabs.query({ url: ["*://labs.google.com/*", "*://labs.google/*"] }, (tabs: any[]) => {
    const activeTab = tabs.find(t => t.active) || tabs[0];
    if (!activeTab) return;
    
    state.targetTabId = activeTab.id;
    saveState();

    if (state.currentSceneIndex >= state.activeScripts.length) return;
    
    const script = state.activeScripts[state.currentSceneIndex];
    chrome.tabs.sendMessage(state.targetTabId!, {
      type: 'GENERATE_SCENE',
      jobId: state.activeJobId,
      prompt: script,
      sceneIndex: state.currentSceneIndex,
      previousFrame: state.lastFrameBase64,
      config: state.activeConfig
    });
  });
}

chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
  if (message.type === 'START_GENERATION') {
    state.activeJobId = message.jobId;
    state.activeScripts = message.scripts;
    state.activeConfig = message.config;
    state.currentSceneIndex = 0;
    state.generatedVideoUrls = [];
    state.generatedVideoData = [];
    state.lastFrameBase64 = null;
    state.retryCount = 0;
    saveState();
    
    chrome.tabs.query({ url: ["*://labs.google.com/*", "*://labs.google/*"] }, (tabs: any[]) => {
      const activeTab = tabs.find(t => t.active) || tabs[0];
      if (activeTab) {
        state.targetTabId = activeTab.id!;
        chrome.tabs.update(state.targetTabId!, { active: true });
        
        chrome.tabs.sendMessage(state.targetTabId!, { type: 'PING' }, (response: any) => {
          if (chrome.runtime.lastError || !response) {
            chrome.runtime.sendMessage({ type: 'SCENE_FAILED', error: "Robot không phản hồi. Hãy F5 trang web!" });
          } else {
            startNextScene();
          }
        });
      } else {
        chrome.runtime.sendMessage({ type: 'SCENE_FAILED', error: "Vui lòng mở trang Google Labs VideoFX!" });
      }
    });
    
    sendResponse({ status: "started" });
    return true;
  }

  if (message.type === 'SCENE_COMPLETED') {
    if (message.jobId !== state.activeJobId) return;
    if (state.generatedVideoUrls.length > state.currentSceneIndex) return;

    state.generatedVideoUrls.push(message.videoUrl);
    state.generatedVideoData.push(message.videoData); // Lưu dữ liệu thật
    state.lastFrameBase64 = message.extractedFrame || null;

    chrome.runtime.sendMessage({
      type: 'PROGRESS_UPDATE',
      jobId: state.activeJobId,
      scene: state.currentSceneIndex + 1,
      videoUrl: message.videoUrl,
      videoData: message.videoData
    });

    state.currentSceneIndex++;
    state.retryCount = 0;
    saveState();

    if (state.currentSceneIndex < state.activeScripts.length) {
      chrome.alarms.create('next_scene_alarm', { delayInMinutes: 3 / 60 });
    } else {
      chrome.runtime.sendMessage({
        type: 'GENERATION_FINISHED',
        jobId: state.activeJobId,
        videoUrls: state.generatedVideoUrls,
        videoDataList: state.generatedVideoData
      });
      state.activeJobId = null;
      saveState();
    }
  }

  if (message.type === 'SCENE_FAILED') {
    if (message.jobId !== state.activeJobId && message.jobId !== undefined) return;

    const maxRetries = state.activeConfig?.maxRetries || 3;
    if (state.retryCount < maxRetries) {
      state.retryCount++;
      saveState();
      chrome.alarms.create('retry_scene_alarm', { delayInMinutes: 5 / 60 });
    } else {
      chrome.runtime.sendMessage({
        type: 'SCENE_FAILED',
        jobId: state.activeJobId,
        error: message.error || 'Lỗi Robot',
        scene: state.currentSceneIndex + 1
      });
      state.activeJobId = null;
      state.activeScripts = [];
      saveState();
    }
  }

  if (message.type === 'PING') {
    sendResponse({ status: "alive", jobId: state.activeJobId });
    return true;
  }
});
