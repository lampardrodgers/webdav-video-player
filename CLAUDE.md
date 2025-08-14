# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a WebDAV video player demo that enables streaming video playback from cloud storage through WebDAV protocol. The project has evolved from a basic client-side player to include sophisticated proxy servers with Range request support, real-time performance monitoring, and intelligent buffering strategies.

## Version History

### v0.1.2 (Latest) - Enhanced Buffering & Network Monitoring
**Major Features:**
- **Dual-layer buffer visualization**: Separate display for server transmission progress vs browser buffer status
- **Intelligent Range request optimization**: Improved from 1-2MB to 5-10MB chunking for better streaming performance  
- **Smart preloading system**: Auto preload with 20MB buffer, triggered during play/pause events
- **Real-time network monitoring**: Latency measurement and buffer health assessment
- **Enhanced user experience**: Color-coded network status indicators and buffer explanations

**Technical Improvements:**
- Range request optimization now handles small requests (<5MB) by expanding to 10MB chunks
- Medium requests (5-20MB) get 1.5x expansion for smoother playback
- Video preload attribute changed from "metadata" to "auto" for better initial buffering
- Network latency tracking with 5-sample rolling average
- Buffer health calculation based on available buffered content ahead of playback position

## Core Architecture

### Dual Proxy Server Architecture
The project features two proxy server implementations:

1. **enhanced-proxy-server.js** - Caching proxy with segmented downloads and file-based caching
2. **streaming-proxy-server.js** - Pure streaming proxy optimized for real-time transmission

Both servers run on port 8090 and proxy requests to a hardcoded WebDAV target (`webdav-1839857505.pd1.123pan.cn`).

### Client Applications
- **enhanced-player.html** - Advanced player with real-time statistics, intelligent prebuffering, and visual buffer indicators
- **streaming-player.html** - Streamlined player optimized for the streaming proxy
- **index.html** - Original basic WebDAV player (legacy)

### Key Technical Components

#### Range Request Handling
Both proxy servers implement sophisticated Range request processing:
- Parse HTTP Range headers for partial content requests
- Handle 302 redirects to CDN endpoints 
- Support streaming transmission without full file buffering
- Implement fallback mechanisms when upstream doesn't support Range

#### Prebuffering System (Enhanced Player)
The enhanced player includes intelligent prebuffering:
- Configurable preload strategies (auto, metadata, none)
- Adaptive buffer sizing (5MB to 50MB)
- Background segment downloading with worker queue system
- Visual buffer segment indicators in progress bar

#### Real-time Statistics
- Transfer speed monitoring with 10-second rolling windows
- Active request tracking with unique request IDs
- Buffer status visualization
- Network performance metrics

## Development Commands

### Starting the Servers
```bash
# Start the streaming proxy (recommended for development)
node streaming-proxy-server.js

# Start the enhanced proxy with caching
node enhanced-proxy-server.js
```

### Testing the Application
Open the corresponding HTML files in a browser:
- `enhanced-player.html` - Use with enhanced-proxy-server.js
- `streaming-player.html` - Use with streaming-proxy-server.js
- `index.html` - Basic player, works with either proxy

### Development Testing
The proxy servers provide a `/api/stats` endpoint for real-time monitoring. Access `http://localhost:8090/api/stats` to view current transfer statistics.

## Important Implementation Details

### Target Configuration
Both proxy servers are hardcoded to target `webdav-1839857505.pd1.123pan.cn`. To work with different WebDAV servers, modify the `TARGET_HOST` and `TARGET_PATH` constants.

### CORS Configuration
The servers include comprehensive CORS headers to support browser-based WebDAV operations. The configuration supports all standard WebDAV methods including PROPFIND, MKCOL, COPY, MOVE.

### Error Handling Strategy
- Comprehensive request/response logging with structured request IDs
- Graceful fallback from Range requests to full downloads when upstream doesn't support partial content
- 302 redirect handling with direct CDN communication
- Connection pooling and reuse for performance

### Buffer Management
The enhanced proxy implements a sophisticated caching system:
- Segment-based caching (2MB segments)
- LRU cache eviction with 500MB limit
- Adjacent segment merging for optimal cache utilization
- Memory and disk-based caching hybrid approach

## Key Files and Their Purposes

- `streaming-proxy-server.js` - Production-ready streaming proxy, optimized for real-time video transmission
- `enhanced-proxy-server.js` - Feature-rich proxy with caching and advanced optimizations
- `enhanced-player.html` - Most advanced player with full feature set
- `app.js` - Core WebDAV client logic shared across players
- `logger.js` - Centralized logging system with multiple severity levels
- `video-player.js` - Video playback functionality and controls

## Performance Considerations

The streaming proxy is optimized for immediate playback with minimal buffering, while the enhanced proxy trades some latency for improved cache efficiency and reduced bandwidth usage on repeated access. Choose based on use case:

- **Streaming proxy**: Best for one-time viewing, minimal memory usage
- **Enhanced proxy**: Best for repeated access, better for slow connections

When working with the prebuffering system, be aware that it can generate significant background network traffic. The system is designed to be adaptive based on playback patterns and pause/play states.