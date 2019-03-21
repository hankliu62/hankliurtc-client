
import 'webrtc-adapter';
import EventEmitter from './EventEmitter';
import UUID from 'uuid';

export default class HankLiuRTC extends EventEmitter {
  constructor(options = {}) {
    super(options);

    // 当前客户端所处的房间
    this.room = options.name || '';
    // 本地的媒体流
    this.localMediaStream = null;
    // 本地WebSocket连接
    this.socket = null;
    // 服务器返回的本地 WebSocket 的 uuid，表示当前客户端，与服务器的标识保持一致
    this.myselfSocketId = '';
    // 服务器返回的本地 WebSocket 的 avatar，表示当前客户端，与服务器的标识保持一致
    this.myselfSocketAvatar = '';
    // 暂存正在接收的文件
    this.filesData = {};
    // 保存与本地相连的所有的peer connection, 键为其客户端 Socket 的 uuid，值为 PeerConnection 类型
    this.peerConnections = {};
    // 保存与本地相连的所有的 socket, { [id]: { id: '', avatar: '' } }
    this.remoteSockets = {};
    // 保存所有的data channel，键为客户端 Socket 的 uuid，值为通过 PeerConnection 实例的 createDataChannel 创建的 DataChannel 类型
    this.dataChannels = {};
    // 保存所有需要发送文件的data channel及其需要发送文件状态
    this.fileDataChannels = {};
    // 保存所有接受到的文件
    this.receivedFiles = {};

    // 初始时需要构建媒体流的数目
    this.needStreamsCount = 0;
    // 初始时已经构建媒体流的数目
    this.initializedStreamsCount = 0;

    // 接收来自服务器的 socket 发送过来特定 event 的 message
    this.on('new_peer', (data) => {
      const socketId = data.socketId;
      const socketAvatar = data.socketAvatar;
      const peerConnection = this.createPeerConnection(socketId);
      peerConnection.addStream(this.localMediaStream);
      this.remoteSockets[socketId] = { id: socketId, avatar: socketAvatar };
      this.emit('_new_peer', socketId, socketAvatar);
    });

    this.on('peers', (data) => {
      const { connections, avatars, me, myselfAvatar } = data;
      // 重置
      this.remoteSockets = {};
      for (let i = 0; i < (connections || []).length; i ++) {
        const id = connections[i];
        const avatar = avatars[i];
        this.remoteSockets[connections[i]] = { id, avatar };
      }
      this.myselfSocketId = me;
      this.myselfSocketAvatar = myselfAvatar;
      this.emit('_peers', connections, avatars, me, myselfAvatar);
      // 接收到 peers 事件表示已与服务器建立了连接
      this.emit('_connected', this.socket);
    });

    this.on('ice_candidate', (data) => {
      const candidate = new RTCIceCandidate(data);
      const peerConnection = this.peerConnections[data.socketId];
      if (peerConnection) {
        peerConnection.addIceCandidate(candidate);
      }
      this.emit('_get_ice_candidate', candidate);
    });

    this.on('remove_peer', (data) => {
      const { socketId } = data;
      this.closePeerConnection(this.peerConnections[socketId]);
      delete this.peerConnections[socketId];
      delete this.dataChannels[socketId];

      for (const sendId in this.fileDataChannels[socketId]) {
        if (Object.prototype.hasOwnProperty.call(this.fileDataChannels[socketId], sendId)) {
          this.emit('_send_file_error', new Error('Connection has been closed'), socketId, sendId, this.fileDataChannels[socketId][sendId].file);
        }
      }

      delete this.fileDataChannels[socketId];
      this.emit('_remove_peer', socketId);
    });

    this.on('offer', (data) => {
      const { socketId, sdp } = data;
      this.receiveOffer(socketId, sdp);
      this.emit('_get_offer', data);
    });

    this.on('answer', (data) => {
      const { socketId, sdp } = data;
      this.receiveAnswer(socketId, sdp);
      this.emit('_get_answer', data);
    });

    // 监听客户端内部事件
    this.on('_ready', () => {
      this.createPeerConnections();
      this.addStreams();
      this.addDataChannels();
      this.sendOffers();
    });

    // 发送文件时失败
    this.on('_send_file_error', (error, socketId, sendId) => {
      this.cleanSendFile(socketId, sendId);
    });

    // 接收文件时失败
    this.on('_receive_file_error', (error, sendId) => {
      this.cleanReceivedFile(sendId);
    });
  }

  iceServer = {
    "iceServers": [{
        "url": "stun:stun.l.google.com:19302"
    }]
  };

  defaultMaxFileChunkSize = 1000

  // 创建 WebSocket，与服务器 Socket 建立连接，监听 WebSocket 事件
  connect = (server) => {
    const socket = new WebSocket(server);

    // 监听建立时触发事件
    socket.onopen = () => {
      socket.send(JSON.stringify({
        eventName: 'join',
        data: {
          room: this.room
        }
      }));

      this.emit('_socket_opened', socket, this.room);
    }

    // 监听客户端接收服务端数据时触发事件
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.eventName) {
        this.emit(data.eventName, data.data);
      } else {
        this.emit('_socket_received_message', socket, data);
      }
    }

    // 监听通信发生错误时触发事件
    socket.onerror = (error) => {
      this.emit('_socket_error', socket, error);
    }

    // 监听连接关闭时触发事件
    socket.onclose = () => {
      this.emit('_socket_closed', socket);
    }

    this.socket = socket;
  }


  /**********************************************************/
  /*                                                        */
  /*                    点对点连接部分                       */
  /*                                                        */
  /**********************************************************/

  // 给所有的客户端都创建一个PeerConnection
  createPeerConnections = () => {
    for (const socketId in this.remoteSockets) {
      if (Object.prototype.hasOwnProperty.call(this.remoteSockets, socketId)) {
        this.createPeerConnection(socketId);
      }
    }
  }

  // 创建 RTCPeerConnection 实例，添加事件处理器
  createPeerConnection = (socketId) => {
    const peerConnection = new RTCPeerConnection(this.iceServer);
    this.peerConnections[socketId] = peerConnection;

    // 是收到 icecandidate 事件时调用的事件处理器。当一个 RTCICECandidate 对象被添加时，这个事件被触发。
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        // 通过 Socket 给远方的 peer 发送 ice candidate
        this.socket.send(JSON.stringify({
          eventName: 'ice_candidate',
          data: {
            socketId,
            candidate: event.candidate.candidate,
            label: event.candidate.sdpMLineIndex
          }
        }));
      }

      this.emit('_peer_connection_get_ice_candidate', event.candidate, socketId, peerConnection);
    }

    // TODO: 是否存在这个 onopen 事件监听处理函数
    // RTCPeerConnection 创建成功时触发
    peerConnection.onopen = () => {
      this.emit('_peer_connection_open', socketId, peerConnection);
    }

    // 是收到addstream 事件时调用的事件处理器。 Such an event is 当MediaStream 被远端机器添加到这条连接时，该事件会被触发。
    // 当调用RTCPeerConnection.setRemoteDescription()方法时，这个事件就会被立即触发，它不会等待SDP协商的结果。
    peerConnection.onaddstream = (event) => {
      this.emit('_peer_connection_add_stream', event.stream, socketId, peerConnection);
    }

    // 是收到datachannel 事件时调用的事件处理器。 当一个 RTCDataChannel 被添加到连接时，这个事件被触发。
    // 当这个datachannel事件在RTCPeerConnection发生时，它指定的那个事件处理函数就会被调用
    // 这个事件继承于 RTCDataChannelEvent，当远方伙伴调用createDataChannel()时这个事件被加到这个连接（RTCPeerConnection）中。
    // 在这个事件被收到的同时，这个RTCDataChannel 实际上并没有打开，确保在open这个事件在RTCDataChannel触发以后才去使用它。
    peerConnection.ondatachannel = (event) => {
      this.addDataChannel(socketId, event.channel);
      this.emit('_peer_connection_add_data_channel', event.channel, socketId, peerConnection);
    }

    return peerConnection;
  }

  // 关闭删除 RTCPeerConnection 实例
  closePeerConnection = (peerConnection) => {
    if (!peerConnection) {
      return;
    }

    peerConnection.close();
  }


  /**********************************************************/
  /*                                                        */
  /*                      信令交换部分                       */
  /*                                                        */
  /**********************************************************/

  // 向所有的 PeerConnection 发送 Offer 类型信令
  sendOffers = () => {
    const genCreateOfferSuccessHandler = (peerConnection, socketId) => {
      return (offer) => {
        peerConnection.setLocalDescription(offer);
        this.socket.send(JSON.stringify({
          eventName: 'offer',
          data: {
            sdp: offer,
            socketId
          }
        }));
      };
    };

    const createOfferFailed = (error) => {
      this.emit('create_offer_error', socketId, error);
    };

    for (const socketId in this.peerConnections) {
      if (Object.prototype.hasOwnProperty.call(this.peerConnections, socketId)) {
        const peerConnection = this.peerConnections[socketId];
        peerConnection.createOffer(genCreateOfferSuccessHandler(peerConnection, socketId), createOfferFailed);
      }
    }
  }

  // 接收到 Offer 类型信令后，需要返回发送 Answer 类型信令
  receiveOffer = (socketId, sdp) => {
    this.sendAnswer(socketId, sdp);
  }

  // 发送 Answer 类型信令
  sendAnswer = (socketId, sdp) => {
    const peerConnection = this.peerConnections[socketId];
    peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    peerConnection.createAnswer((answer) => {
      peerConnection.setLocalDescription(answer);
      this.socket.send(JSON.stringify({
        eventName: 'answer',
        data: {
          socketId: socketId,
          sdp: answer
        }
      }));
    }, (error) => {
      this.emit('_create_answer_error', error, socketId, sdp);
    });
  }

  // 接收到 Answer 类型信令后，需要将对方的 RTCSessionDescription 设置到 peerConnection 中
  receiveAnswer = (socketId, sdp) => {
    const peerConnection = this.peerConnections[socketId];
    peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  }


  /**********************************************************/
  /*                                                        */
  /*                      数据通道连接部分                    */
  /*                                                        */
  /**********************************************************/

  // 为指定 socketId 的 PeerConnection 实例创建一个 DataChannel ，并添加到 PeerConnection 实例中
  createDataChannel = (socketId, label) => {
    let dataChannel;
    if (!socketId) {
      this.emit('_create_data_channel_error', socketId, new Error('attempt to create data channel without socket id'));
    }

    const peerConnection = this.peerConnections[socketId];

    if (!(peerConnection instanceof RTCPeerConnection)) {
      this.emit('_create_data_channel_error', socketId, new Error('attempt to create data channel without peerConnection'));
    }

    try {
      dataChannel = peerConnection.createDataChannel(label)
    } catch (error) {
      this.emit('_create_data_channel_error', socketId, error);
      return null;
    }

    return this.addDataChannel(socketId, dataChannel);
  }

  // 添加 dataChannel 到本地缓存，同时给 dataChannel 添加事件，用于端对端的直接通讯已经收发文件
  addDataChannel = (socketId, dataChannel) => {
    const socket = this.remoteSockets[socketId];
    // 当接收到 open 事件时的事件处理器，当底层链路数据传输成功，端口状态处于 established 的时候会触发该事件。
    dataChannel.onopen = () => {
      this.emit('_data_channel_opened', socketId, dataChannel);
    };

    // 当接收到 message 事件时的事件处理器。当有数据被接收的时候会触发该事件。
    dataChannel.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.type === 'file') {
        // 分析接收到的 message ，同时分发处理函数
        this.parseFilePacket(data, socketId, dataChannel);
      } else {
        this.emit('_data_channel_message', data.data, socketId, socket.avatar, dataChannel);
      }
    }

    // 当接收到 close 事件时候的事件处理器。当底层链路被关闭的时候会触发该事件。
    dataChannel.onclose = () => {
      delete this.dataChannels[socketId];
      this.emit('_data_channel_closed', socketId, dataChannel);
    }

    // 当接收到 error 事件时候的事件处理器。
    dataChannel.onerror = (event) => {
      this.emit('_data_channel_error', event, socketId, dataChannel);
    }

    this.dataChannels[socketId] = dataChannel;

    return dataChannel;
  }

  // 为每一个 PeerConnection 实例创建一个 DataChannel ，并添加到 PeerConnection 实例中
  addDataChannels = () => {
    for (const socketId in this.peerConnections) {
      if (Object.prototype.hasOwnProperty.call(this.peerConnections, socketId)) {
        this.createDataChannel(socketId);
      }
    }
  }


  /**********************************************************/
  /*                                                        */
  /*                       流处理部分                        */
  /*                                                        */
  /**********************************************************/

  // 创建本地流
  createStream = (constraints) => {
    constraints.video = !!constraints.video;
    constraints.audio = !!constraints.audio;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      this.needStreamsCount ++;
      navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        this.localMediaStream = stream;
        this.initializedStreamsCount ++;
        this.emit('_stream_created', stream);
        if (this.initializedStreamsCount === this.needStreamsCount) {
          this.emit('_ready');
        }
      }).catch((error) => {
        this.emit('_stream_create_error', error);
      });
    } else {
      this.emit('_stream_create_error', new Error('WebRTC is not yet supported in this browser.'));
    }
  }

  // 将本地媒体流添加到所有的 PeerConnection 实例中
  addStreams = () => {
    for (const socketId in this.peerConnections) {
      if (Object.prototype.hasOwnProperty.call(this.peerConnections, socketId)) {
        this.peerConnections[socketId].addStream(this.localMediaStream);
      }
    }
  }


  /**********************************************************/
  /*                                                        */
  /*                       文件传输                          */
  /*                                                        */
  /**********************************************************/

  // 解析Data channel上的文件类型包,来确定信令类型
  parseFilePacket = (data, socketId) => {
    const signal = data.signal;

    if (signal === 'ask') { // 询问是否接收文件
      this.receiveSendFileAsk(data.sendId, data.name, data.size, socketId);
    } else if (signal === 'accept') { // 同意接收
      this.receiveSendFileAccept(data.sendId, socketId);
    } else if (signal === 'refuse') { // 拒绝接收
      this.receiveSendFileRefuse(data.sendId, socketId);
    } else if (signal === 'chunk') { // 传输接收文件块
      this.receiveSendFileChunk(data.data, data.sendId, socketId, data.last, data.percent);
    } else if (signal === 'close') { // 结束接收
      // TODO
    }
  }

  /***********************发送者部分***********************/
  // 通过Data channel向房间内所有其他用户广播消息
  broadcastMessage = (message) => {
    for (const socketId in this.dataChannels) {
      const dataChannel = this.dataChannels[socketId];
      dataChannel.send(JSON.stringify({
        type: 'message',
        data: message
      }));
    }
  }

  // 通过Data channel向房间内所有其他用户广播文件
  broadcastFile = (fileElement) => {
    for (const socketId in this.dataChannels) {
      this.sendFile(fileElement, socketId);
    }
  }

  // 给用户发送文件
  sendFile = (fileElement, socketId) => {
    if (typeof fileElement === 'string') {
      fileElement = document.getElementById(fileElement);
    }

    if (!fileElement) {
      this.emit('_send_file_error', new Error('Can not find dom while sending file'), socketId);
      return;
    }

    if (!fileElement.files || !fileElement.files[0]) {
      this.emit('_send_file_error', new Error('No file need to be sent'), socketId);
      return;
    }

    const file = fileElement.files[0];
    this.fileDataChannels[socketId] = this.fileDataChannels[socketId] || {};
    const sendId = UUID.v4();
    const fileInfo = { file: file, state: 'ask' };
    this.fileDataChannels[socketId][sendId] = fileInfo;
    const sent = this.sendAskDataChannelMessage(socketId, sendId, fileInfo);
    if (sent) {
      this.emit('_send_file', sendId, socketId, file);
    }
  }

  // 通过DataChannel发送文件请求(ask)，请求接收方接收
  sendAskDataChannelMessage = (socketId, sendId, fileInfo) => {
    const dataChannel = this.dataChannels[socketId];
    if (!dataChannel) {
      this.emit('_send_file_error', new Error('DataChannel has been closed'), socketId, sendId, fileInfo.file);
      return false;
    }

    const message = {
      name: fileInfo.file.name,
      size: fileInfo.file.size,
      sendId: sendId,
      type: 'file',
      signal: 'ask'
    };
    dataChannel.send(JSON.stringify(message));

    return true;
  }

  // 当对方同意接收文件时，开始发送文件（文件过大时，分块发送）
  sendFileByChunks = () => {
    // 是否需要继续循环发送文件
    let needContinueSendFileChunk;
    for(const socketId in this.fileDataChannels) {
      if (Object.prototype.hasOwnProperty.call(this.fileDataChannels, socketId)) {
        for (const sendId in this.fileDataChannels[socketId]) {
          if (Object.prototype.hasOwnProperty.call(this.fileDataChannels[socketId], sendId)) {
            // 存在需要发送的文件
            if (this.fileDataChannels[socketId][sendId].state === 'send') {
              needContinueSendFileChunk = true;
              this.sendFileChunk(socketId, sendId);
            }
          }
        }
      }
    }

    if (needContinueSendFileChunk) {
      // 每10ms发送一次 file chunk
      setTimeout(() => {
        this.sendFileByChunks();
      }, 10);
    }
  }

  // 给指定 socketId 的客户端发送文件块，根据 socketId 和 sendId 获得发送文件的内容，根据socketId 获得 dataChannel
  sendFileChunk = (socketId, sendId) => {
    const fileInfo = this.fileDataChannels[socketId][sendId];
    const dataChannel = this.dataChannels[socketId];
    if (!dataChannel) {
      this.emit('_send_file_error', new Error('DataChannel has been destroyed'), socketId, sendId, fileInfo.file);
      return;
    }

    const message = {
      type: 'file',
      signal: 'chunk',
      sendId,
    };

    const data = fileInfo.fileData.slice(fileInfo.sentPacketsCount * this.defaultMaxFileChunkSize, (fileInfo.sentPacketsCount + 1) * this.defaultMaxFileChunkSize);
    message.data = data;
    if (fileInfo.sentPacketsCount + 1 <= fileInfo.allPacketsCount) { // 发送文件某个块
      message.last = false;
      message.percent = (fileInfo.sentPacketsCount + 1) / fileInfo.allPacketsCount * 100;
      this.emit('_send_file_chunk', sendId, socketId, message.percent, fileInfo.file);
    } else { // 发送完毕
      message.last = true;
      fileInfo.state = 'end';
      this.emit('_sent_file', sendId, socketId, fileInfo.file);
      this.cleanSendFile(sendId, socketId);
    }

    dataChannel.send(JSON.stringify(message));

    fileInfo.sentPacketsCount ++;
    fileInfo.willSendPacketsCount --;
  }

  // 同意接收文件请求，当前客户端同意接收远程用户发送过来的发送文件请求时，发送同意接收文件信令
  sendAcceptReceiveFileMessage = (socketId, sendId) => {
    const dataChannel = this.dataChannels[socketId];
    if (!dataChannel) {
      this.emit('_receive_file_error', new Error('DataChannel has been destroyed'), sendId);
      return;
    }

    const message = {
      sendId,
      type: 'file',
      signal: 'accept',
    }
    dataChannel.send(JSON.stringify(message));
  }

  // 拒绝接收文件请求，当前客户端同意接收远程用户发送过来的发送文件请求时，发送拒绝接收文件信令
  sendRefuseReceiveFileMessage = (socketId, sendId) => {
    const dataChannel = this.dataChannels[socketId];
    if (!dataChannel) {
      this.emit('_receive_file_error', new Error('DataChannel has been destroyed'), sendId);
      return;
    }

    const message = {
      sendId,
      type: 'file',
      signal: 'refuse',
    }
    dataChannel.send(JSON.stringify(message));

    this.cleanReceivedFile(sendId);
  }

  // 接收到发送文件请求后记录文件信息
  receiveSendFileAsk = (sendId, fileName, fileSize, socketId) => {
    this.receivedFiles[sendId] = {
      socketId: socketId,
      state: 'ask',
      name: fileName,
      size: fileSize
    };
    this.emit('_receive_file_ask', sendId, socketId, fileName, fileSize);
  }

  // 发送文件请求后若对方同意接受,开始传输
  receiveSendFileAccept = (sendId, socketId) => {
    const fileInfo = this.fileDataChannels[socketId][sendId];
    const reader = new window.FileReader(fileInfo.file);
    reader.readAsDataURL(fileInfo.file);
    reader.onload = (event) => {
      fileInfo.state = 'send';
      fileInfo.fileData = event.target.result;
      fileInfo.sentPacketsCount = 0;
      fileInfo.allPacketsCount = parseInt(fileInfo.fileData.length / this.defaultMaxFileChunkSize, 10);
      fileInfo.willSendPacketsCount = fileInfo.allPacketsCount;
      this.sendFileByChunks();
    };
    this.emit('_send_file_accepted', sendId, socketId, this.fileDataChannels[socketId][sendId].file);
  }

  // 发送文件请求后若对方拒绝接受,清除掉本地的文件信息
  receiveSendFileRefuse = (sendId, socketId) => {
    this.fileDataChannels[socketId][sendId].state = 'refused';
    this.emit('_send_file_refused', sendId, socketId, this.fileDataChannels[socketId][sendId].file);
    this.cleanSendFile(sendId, socketId);
  }

  /***********************发送者部分***********************/

  // 接收到文件块
  receiveSendFileChunk = (data, sendId, socketId, last, percent) => {
    const fileInfo = this.receivedFiles[sendId];
    if (!fileInfo.data) {
      fileInfo.state = 'receive';
      fileInfo.data = '';
    }
    fileInfo.data += data;
    if (last) {
      fileInfo.state = 'end';
      this.downloadReceivedFile(sendId);
    } else {
      this.emit('_receive_file_chunk', sendId, socketId, fileInfo.name, percent);
    }
  }

  // 接收完所有文件块后，将其组合成一个完整的文件并自动下载
  downloadReceivedFile = (sendId) => {
    const fileInfo = this.receivedFiles[sendId];

    const downloadLink = document.createElement("a")
    const mouseEvent = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true
    });
    downloadLink.href = fileInfo.data;
    downloadLink.target = '_blank';
    downloadLink.download = fileInfo.name || 'received';
    downloadLink.dispatchEvent(mouseEvent);

    this.emit('_received_file', sendId, fileInfo.socketId, fileInfo.name);
    this.cleanReceivedFile(sendId);
  }

  // 清除发送的文件缓存
  cleanSendFile = (socketId, sendId) => {
    if (this.fileDataChannels[socketId]) {
      delete this.fileDataChannels[socketId][sendId];
    }
  }

  // 清除接受文件缓存
  cleanReceivedFile = (sendId) => {
    delete this.receivedFiles[sendId];
  }
}