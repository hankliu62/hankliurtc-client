import './index.css';

import HankLiuRTC from '~/lib/HankLiuRTC';

const hankLiuRTCClient = new HankLiuRTC();

const sendBtnMessage = document.getElementById('sendBtnMessage');
const content = document.getElementById('content');
const messages = document.getElementById('messages');
const file = document.getElementById('file');
const sendBtnFile = document.getElementById('sendBtnFile');
const notifications = document.getElementById('notifications');

const genNotification = (id, title, description) => {
  const notification = document.createElement('div');
  notification.setAttribute('id', id);
  notification.setAttribute('class', 'notification notification-top-right');
  notification.innerHTML = `
    <div class="notification-notice notification-notice-closable">
      <div class="notification-notice-content">
        <div class="notification-notice-message">${title}</div>
        <div class="notification-notice-description">${description}</div>
      </div>
      <a id="closeBtn" class="notification-notice-close">
        <svg viewBox="64 64 896 896" class="" data-icon="close" width="1em" height="1em" fill="currentColor" aria-hidden="true">
          <path d="M563.8 512l262.5-312.9c4.4-5.2.7-13.1-6.1-13.1h-79.8c-4.7 0-9.2 2.1-12.3 5.7L511.6 449.8 295.1 191.7c-3-3.6-7.5-5.7-12.3-5.7H203c-6.8 0-10.5 7.9-6.1 13.1L459.4 512 196.9 824.9A7.95 7.95 0 0 0 203 838h79.8c4.7 0 9.2-2.1 12.3-5.7l216.5-258.1 216.5 258.1c3 3.6 7.5 5.7 12.3 5.7h79.8c6.8 0 10.5-7.9 6.1-13.1L563.8 512z"></path>
        </svg>
      </a>
    </div>
  `;

  notifications.appendChild(notification);
  const closes = notification.getElementsByClassName('notification-notice-close');
  if (closes && closes.length) {
    closes[0].addEventListener('click', () => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    });
  }
  return notification;
}

const appendMessageElement = (message, avatar) => {
  const msgEle = document.createElement('p')
  msgEle.innerText = message;
  messages.appendChild(msgEle);
}

const broadcastMessage = () => {
  const message = content.value;

  if (!message) {
    console.error('Message is required.');
    return;
  }

  hankLiuRTCClient.broadcastMessage(message);

  content.value = '';
  appendMessageElement('me: ' + message);
}

content.addEventListener('keydown', function(event) {
    const evt = window.event || event;
    if (evt.keyCode === 13) {
      broadcastMessage();
    }
});

// 广播发送消息
sendBtnMessage.addEventListener('click', function() {
  broadcastMessage();
});

// 广播发送文件
sendBtnFile.addEventListener('click', function() {
  hankLiuRTCClient.broadcastFile(file);
});

// 将媒体流绑定到 video 标签元素上用于输出
const attachStream = (stream, elem) => {
  if (typeof elem === 'string') {
    elem = document.getElementById(elem);
  }

  if (elem.mozSrcObject) {
    elem.mozSrcObject = stream;
    elem.play();
  } else {
    elem.srcObject = stream;
  }
}

// WebSocket 创建成功
hankLiuRTCClient.on('_connected', () => {
  // 创建本地媒体流
  hankLiuRTCClient.createStream({
    video: true,
    audio: true
  });
});

// 本地媒体流创建成功
hankLiuRTCClient.on('_stream_created', (stream) => {
  const video = document.getElementById('me');
  video.srcObject = stream;
  video.play();
});

// 本地媒体流创建失败
hankLiuRTCClient.on('_stream_create_error', (error) => {
  console.error('stream_create_error', error);
});

// 新的用户加入房间时，收到新用户的远程流媒体
hankLiuRTCClient.on('_peer_connection_add_stream', (stream, socketId) => {
  const videos = document.getElementById('otherVideos');
  const otherVideo = document.createElement('video');
  const id = `other-${socketId}`;
  otherVideo.setAttribute('class', 'other');
  otherVideo.setAttribute('autoplay', 'autoplay');
  otherVideo.setAttribute('id', id);
  videos.appendChild(otherVideo);
  attachStream(stream, otherVideo);
});

// 删除其他用户
hankLiuRTCClient.on('_remove_peer', (socketId) => {
  const otherVideo = document.getElementById(`other-${socketId}`);
  if (otherVideo) {
    // 移除视频元素
    otherVideo.parentNode.removeChild(otherVideo);
  }
});

// 获得所有的远端 Peer 的 Socket 的信息，已经自身的信息
hankLiuRTCClient.on('_peers', (connections, avatars, me, myselfAvatar) => {
  const avatar = document.getElementById('avatar');
  avatar.setAttribute('src', myselfAvatar);
  const name = document.getElementById('name');
  name.innerText = me;
});

// 收到来自其他客户端的消息
hankLiuRTCClient.on('_data_channel_message', (message, socketId, avatar) => {
  appendMessageElement(socketId + ': ' + message, avatar);
});

// 发送文件时失败
hankLiuRTCClient.on('_send_file_error', (error) => {
  console.error('_send_file_error', error);
});

// 监听向远端用户发送文件请求信息成功后的事件
hankLiuRTCClient.on('_send_file', (sendId, socketId, file) => {
  genNotification(`sf-${sendId}`, '发送文件请求', `请求向用户(${socketId})发送文件(${file.name})`);
});

// 接收文件时失败
hankLiuRTCClient.on('_receive_file_error', (error) => {
  console.error('_receive_file_error', error);
});

// 监听到远端用户发送过来的文件请求信息的事件
hankLiuRTCClient.on('_receive_file_ask', (sendId, socketId, fileName, fileSize) => {
  if (window.confirm(`${socketId}用户想要给你传送${fileName}文件，大小${fileSize}KB,是否接受？`)) {
    hankLiuRTCClient.sendAcceptReceiveFileMessage(socketId, sendId);
    genNotification(`rf-${sendId}`, '接收文件', `准备接收${fileName}文件`);
  } else {
    hankLiuRTCClient.sendRefuseReceiveFileMessage(socketId, sendId);
  }
});

// 监听到远端用户拒绝接收发送的文件事件
hankLiuRTCClient.on('_send_file_refused', (sendId, socketId, file) => {
  const notification = document.getElementById(`sf-${sendId}`);
  if (notification) {
    notification.parentNode.removeChild(notification);
  }

  const newNotification = genNotification(`sf-${sendId}`, '拒绝接收文件', `对方(${socketId})拒绝接收你发送的文件(${file.name})`);

  // 4秒后移除文件
  setTimeout(() => {
    newNotification.parentNode.removeChild(newNotification);
  }, 4000);
});

// 监听到远端用户同意接收发送的文件事件
hankLiuRTCClient.on("_send_file_accepted", (sendId, socketId, file) => {
  const notification = document.getElementById(`sf-${sendId}`);
  const titles = notification.getElementsByClassName('notification-notice-message');
  if (titles && titles.length) {
    titles[0].innerText = '确认接受';
  }

  const descriptions = notification.getElementsByClassName('notification-notice-description');
  if (descriptions && descriptions.length) {
    descriptions[0].innerText = `对方(${socketId})同意接收${file.name}文件，等待发送`;
  }
});

// 监听到发送文件块事件
hankLiuRTCClient.on('_send_file_chunk', (sendId, socketId, percent, file) => {
  const notification = document.getElementById(`sf-${sendId}`);
  const titles = notification.getElementsByClassName('notification-notice-message');
  if (titles && titles.length) {
    titles[0].innerText = '正在传输文件...';
  }

  const descriptions = notification.getElementsByClassName('notification-notice-description');
  if (descriptions && descriptions.length) {
    descriptions[0].innerText = `正在发送${file.name}文件：${Math.ceil(percent)}%`;
  }
});

// 监听到接收文件块事件
hankLiuRTCClient.on('_receive_file_chunk', (sendId, socketId, fileName, percent) => {
  const notification = document.getElementById(`rf-${sendId}`);
  const titles = notification.getElementsByClassName('notification-notice-message');
  if (titles && titles.length) {
    titles[0].innerText = '正在接收文件...';
  }

  const descriptions = notification.getElementsByClassName('notification-notice-description');
  if (descriptions && descriptions.length) {
    descriptions[0].innerText = `正在接收${fileName}文件：${Math.ceil(percent)}%`;
  }
});

// 监听到发送文件完毕事件
hankLiuRTCClient.on('_sent_file', (sendId, socketId, file) => {
  const notification = document.getElementById(`sf-${sendId}`);
  if (notification) {
    notification.parentNode.removeChild(notification);
  }

  const newNotification = genNotification(`sf-${sendId}`, '发送文件完毕', `文件(${file.name})已经发送完毕!`);

  // 4秒后移除文件
  setTimeout(() => {
    newNotification.parentNode.removeChild(newNotification);
  }, 4000);
});

// 监听到接收文件完毕事件
hankLiuRTCClient.on('_received_file', (sendId, socketId, fileName) => {
  const notification = document.getElementById(`rf-${sendId}`);
  if (notification) {
    notification.parentNode.removeChild(notification);
  }

  const newNotification = genNotification(`rf-${sendId}`, '接收文件完毕', `文件(${fileName})已经接收完毕!`);

  // 4秒后移除文件
  setTimeout(() => {
    newNotification.parentNode.removeChild(newNotification);
  }, 4000);
});

hankLiuRTCClient.connect('ws://127.0.0.1:3000');
