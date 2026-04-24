/**
 * Content Script: The Pro Robot for Google Labs VideoFX
 * Version 6.1 - Ultimate Interaction Engine
 */

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------------------------------------------------------------
// 1. AUTOMATION HELPERS
// -------------------------------------------------------------------------

async function injectImageToVideo(base64: string) {
  console.log("🚀 Injecting previous frame...");
  const modeTabs = Array.from(document.querySelectorAll('button')).filter(b => 
    b.textContent?.includes('Ảnh sang video') || b.innerText?.includes('Image to video') || b.textContent?.includes('Image to Video')
  );
  if (modeTabs.length > 0) {
    modeTabs[0].click();
    await sleep(1000);
  }

  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  if (!fileInput) return;

  const res = await fetch(base64);
  const blob = await res.blob();
  const file = new File([blob], "last_frame.jpg", { type: "image/jpeg" });

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  fileInput.files = dataTransfer.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(2000);
}

async function extractLastFrame(videoUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = "anonymous";
    video.src = videoUrl;
    video.onloadeddata = () => { video.currentTime = Math.max(0, video.duration - 0.1); };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      } else resolve(null);
    };
    video.onerror = () => resolve(null);
  });
}

// -------------------------------------------------------------------------
// 2. MAIN AUTOMATION
// -------------------------------------------------------------------------

async function generateScene(prompt: string, sceneIndex: number, previousFrame: string | null, config: any) {
  try {
    console.log(`🎬 Đang xử lý Cảnh ${sceneIndex + 1}...`);

    const currentVideos = Array.from(document.querySelectorAll('video'));
    const oldUrl = currentVideos.find(v => v.src && v.src.includes('storage.googleapis.com') || v.src.includes('getMediaUrlRedirect'))?.src || "";

    await setupVideoConfig(config);

    if (previousFrame && sceneIndex > 0) {
      await injectImageToVideo(previousFrame);
    } else {
      const videoBtn = Array.from(document.querySelectorAll('button')).find(b => 
        (b.textContent?.includes('Video') || b.innerText?.includes('Video')) && !b.textContent?.includes('Ảnh')
      );
      if (videoBtn) videoBtn.click();
      await sleep(1000);
    }

    const editor = document.querySelector('div[contenteditable="true"]') as HTMLElement;
    if (!editor) throw new Error("Không thấy ô nhập prompt!");

    console.log("🚀 Đang nạp kịch bản theo chuẩn Elite...");
    await typeTextElite(editor, prompt);
    await sleep(1000); 

    const sendBtn = findSendButton();
    if (sendBtn) {
      console.log("🔥 Đang kích hoạt chuỗi Click 7 bước...");
      await smartClickElite(sendBtn);
      // Enter dự phòng
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    } else {
      console.warn("⚠️ Không thấy nút Gửi, thử nhấn Enter cưỡng bức...");
      const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
      const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
      editor.dispatchEvent(enterDown);
      editor.dispatchEvent(enterUp);
    }

    const videoUrl = await waitForNewVideo(oldUrl, config.maxRetries || 3);
    const lastFrame = await extractLastFrame(videoUrl);
    return { videoUrl, lastFrame };
  } catch (err) {
    console.error("Lỗi Robot:", err);
    throw err;
  }
}

async function typeTextElite(element: HTMLElement, text: string) {
  element.focus();
  
  // 1. Xóa nội dung cũ
  document.execCommand('selectAll', false, undefined);
  document.execCommand('delete', false, undefined);
  await sleep(200);

  // 2. Combo Ctrl+A dự phòng (theo mẫu Elite)
  element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a", code: "KeyA", ctrlKey: true, keyCode: 65 }));
  await sleep(100);

  // 3. TUYỆT CHIÊU: beforeinput với toàn bộ dữ liệu
  const beforeEvent = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: text
  });
  element.dispatchEvent(beforeEvent);

  // 4. insertText làm dự phòng
  document.execCommand('insertText', false, text);

  // 5. Báo hiệu kết thúc nhập
  element.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await sleep(200);
}

async function smartClickElite(element: HTMLElement) {
  const events = ["pointerover", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"];
  for (const name of events) {
    const ev = new MouseEvent(name, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1
    });
    element.dispatchEvent(ev);
    if (name === "mousedown") await sleep(30);
  }
}

// Hàm smartClick cũ thay bằng smartClickElite ở trên

function findSendButton(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"], i[role="button"]'));
  
  let target = candidates.find(b => {
    const label = (b.getAttribute('aria-label') || '').toLowerCase();
    const text = (b.textContent || '').toLowerCase();
    const title = (b.getAttribute('title') || '').toLowerCase();
    return (label.includes('generate') || label.includes('tạo') || label.includes('send') || title.includes('tạo')) && 
           !label.includes('scene') && !text.includes('trình');
  }) as HTMLElement;

  if (!target) {
    target = candidates.find(b => {
      const html = b.innerHTML.toLowerCase();
      return (html.includes('arrow_forward') || html.includes('send') || html.includes('magic')) && 
             !html.includes('scene');
    }) as HTMLElement;
  }

  if (!target) {
    const chatContainer = document.querySelector('div[contenteditable="true"]')?.parentElement?.parentElement;
    if (chatContainer) {
      const allBtns = Array.from(chatContainer.querySelectorAll('div, span, button')).filter(el => {
        const hEl = el as HTMLElement;
        const style = window.getComputedStyle(hEl);
        return style.cursor === 'pointer' && hEl.offsetWidth > 0;
      });
      target = allBtns[allBtns.length - 1] as HTMLElement;
    }
  }

  return target || null;
}

async function setupVideoConfig(config: any) {
  const ratioBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === config.ratio);
  if (ratioBtn) ratioBtn.click();

  const modelBtn = Array.from(document.querySelectorAll('button')).find(b => 
    b.textContent?.trim().includes(config.model) || b.innerText?.trim().includes(config.model)
  );
  if (modelBtn) modelBtn.click();
  await sleep(1000);
}

async function waitForNewVideo(oldUrl: string, maxRetries: number): Promise<string> {
  console.log(`⌛ Đang đợi video mới...`);
  let retries = 0;
  let lastPercent = -1;

  for (let i = 0; i < 600; i++) { // Tăng thời gian chờ lên 20 phút (600 * 2s)
    // 1. Theo dõi tiến độ phần trăm (%)
    const percentElements = Array.from(document.querySelectorAll('div')).filter(d => 
      /^\d+%$/.test(d.textContent?.trim() || "") && d.offsetWidth > 0
    );
    
    if (percentElements.length > 0) {
      const currentPercent = parseInt(percentElements[0].textContent!.trim());
      if (currentPercent !== lastPercent) {
        console.log(`⏳ Tiến độ: ${currentPercent}%`);
        lastPercent = currentPercent;
      }
    }

    // 2. Kiểm tra lỗi Google
    const errorContainer = Array.from(document.querySelectorAll('div')).find(d => {
      const text = d.textContent?.toLowerCase() || "";
      return (text.includes('unsuccessful') || text.includes('không thành công') || text.includes('error')) && 
             d.offsetWidth > 100;
    });

    const retryBtn = Array.from(document.querySelectorAll('button')).find(b => 
      b.textContent?.toLowerCase().includes('retry') || b.textContent?.toLowerCase().includes('thử lại')
    );

    if (errorContainer && retryBtn) {
      if (retries < maxRetries) {
        console.warn(`⚠️ Lỗi Google. Đang thử lại lần ${retries + 1}...`);
        retryBtn.click();
        retries++;
        await sleep(5000);
        continue;
      }
      throw new Error("Không thể tạo video sau nhiều lần thử.");
    }

    // 3. Kiểm tra video mới
    const videos = Array.from(document.querySelectorAll('video'));
    const newVideo = videos.find(v => 
      v.src && 
      (v.src.includes('storage.googleapis.com') || v.src.includes('getMediaUrlRedirect')) && 
      v.src !== oldUrl &&
      v.readyState >= 2 // Đảm bảo video đã có data
    );
    
    if (newVideo) {
      console.log("✅ Đã tìm thấy VIDEO MỚI!");
      await sleep(1000); // Đợi thêm 1 giây cho ổn định
      return newVideo.src;
    }

    await sleep(2000);
  }
  throw new Error("Hết thời gian chờ video mới.");
}

// -------------------------------------------------------------------------
// 3. LISTENERS
// -------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: "alive" });
    return true;
  }
  if (message.type === 'GENERATE_SCENE') {
    generateScene(message.prompt, message.sceneIndex, message.previousFrame, message.config)
      .then(async result => {
        console.log("📦 Fetching video data for transport...");
        const response = await fetch(result.videoUrl);
        const blob = await response.blob();
        
        // Chuyển blob sang Base64 để gửi qua message (tránh lỗi cross-origin blob)
        const reader = new FileReader();
        reader.onloadend = () => {
          chrome.runtime.sendMessage({
            type: 'SCENE_COMPLETED',
            jobId: message.jobId,
            videoUrl: result.videoUrl, // URL để hiển thị (nếu cần)
            videoData: reader.result,   // Dữ liệu Base64 để ghép
            extractedFrame: result.lastFrame
          });
        };
        reader.readAsDataURL(blob);
      })
      .catch(err => {
        chrome.runtime.sendMessage({ 
          type: 'SCENE_FAILED', 
          jobId: message.jobId,
          error: err.message 
        });
      });
    sendResponse({ status: "processing", jobId: message.jobId });
    return true;
  }
});
