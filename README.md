# RedWine - Household Alcohol Inventory

A web application for managing your household wine and alcohol inventory with AI-powered bottle analysis using local LLMs.

## Features

- **Image Upload**: Upload front and back label images of alcohol bottles
- **AI Analysis**: Automatically analyze bottles using your local LLM (Ollama with vision models)
- **Detailed Information**: Get summaries, background, flavor profiles, food pairings, and storage recommendations
- **Inventory Management**: Track quantity, price, and location of each bottle
- **Storage Locations**: Organize bottles by their storage location in your home
- **Dashboard**: View statistics about your collection

## Requirements

- Node.js 18+
- Ollama (for local LLM integration)
- A vision-capable LLM model (e.g., `llava`, `llava-llama3`)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure LLM (Optional)

Copy the example environment file and configure as needed:

```bash
cp .env.example .env
```

Edit `.env` with your LLM settings:
- `LLM_BASE_URL`: Your Ollama endpoint (default: `http://localhost:11434`)
- `LLM_IMAGE_MODEL`: Vision model name (default: `llava`)

### 3. Set Up Ollama (If not already installed)

1. Install Ollama from https://ollama.ai
2. Pull a vision-capable model:
   ```bash
   ollama pull llava
   ```
   Or for better results:
   ```bash
   ollama pull llava-llama3
   ```

### 4. Start the Server

```bash
npm start
```

The application will be available at http://localhost:3000

## Usage

### Adding a New Bottle

1. Go to the "Add New Bottle" tab
2. Upload front and/or back label images
3. Fill in bottle information (name, type, brand, etc.)
4. Select or add a storage location
5. Click "Add Bottle & Analyze"

If your local LLM is running, the app will automatically analyze the images and populate:
- Summary
- Background information
- Flavor profile
- Food pairings
- Ideal drinking timeframe
- Storage instructions

### Managing Inventory

- View all bottles in the "Inventory" tab
- Click "View Details" to see full information
- Delete bottles you no longer have

### Storage Locations

- Add storage locations (cabinets, cellars, coolers, etc.)
- Track temperature-controlled vs regular storage
- Assign bottles to specific locations

## API Endpoints

- `GET /api/bottles` - List all bottles
- `GET /api/bottles/:id` - Get single bottle
- `POST /api/bottles` - Create new bottle
- `PUT /api/bottles/:id` - Update bottle
- `DELETE /api/bottles/:id` - Delete bottle
- `POST /api/upload-and-analyze` - Upload images and analyze with LLM
- `GET /api/locations` - List all locations
- `POST /api/locations` - Create new location
- `GET /api/stats` - Get inventory statistics

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: SQLite (better-sqlite3)
- **File Upload**: Multer
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **AI**: Ollama API integration

## Project Structure

```
RedWine/
├── package.json       # Dependencies and scripts
├── server.js          # Express server and API routes
├── database.js        # SQLite database setup
├── .env.example       # Environment configuration template
├── public/
│   └── index.html     # Frontend application
└── uploads/
    └── labels/        # Uploaded bottle images
```

## License

MIT