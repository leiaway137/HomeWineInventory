const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { initDatabase, db, saveDatabase, closeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
let appReady = false;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const labelsDir = path.join(uploadsDir, 'labels');
if (!fs.existsSync(labelsDir)) {
  fs.mkdirSync(labelsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, labelsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpeg, jpg, png, webp) are allowed'));
    }
  }
});

// Local LLM configuration
const LLM_CONFIG = {
  provider: process.env.LLM_PROVIDER || 'lmstudio',
  baseUrl: process.env.LLM_BASE_URL || 'http://127.0.0.1:1234/v1',
  model: process.env.LLM_MODEL || 'qwen3.6-35b-a3b-mlx',
  imageModel: process.env.LLM_IMAGE_MODEL || 'qwen3.6-35b-a3b-mlx'
};

// Web search configuration for market price
const SEARCH_CONFIG = {
  provider: process.env.SEARCH_PROVIDER || 'serpapi', // 'serpapi', 'wine-searcher', 'duckduckgo', or 'none'
  apiKey: process.env.SERPAPI_API_KEY || 'cb42a07d7954c9f6b6a1ac1093739b36a3216be454c030a427a3d138eb6423f7',
  wineSearcherUrl: 'https://www.wine-searcher.com/find'
};

// Helper function to call local LLM
async function callLLM(prompt, images = []) {
  try {
    if (LLM_CONFIG.provider === 'ollama') {
      // For Ollama with vision models
      const payload = {
        model: LLM_CONFIG.imageModel,
        messages: [
          {
            role: 'user',
            content: prompt,
            images: images
          }
        ],
        stream: false
      };

      const response = await axios.post(
        `${LLM_CONFIG.baseUrl}/api/generate`,
        payload,
        { timeout: 120000 }
      );

      return response.data.response || response.data.message?.content || '';
    } else if (LLM_CONFIG.provider === 'lmstudio' || LLM_CONFIG.provider === 'vllm') {
      // LM Studio and vllm use OpenAI-compatible API
      const messages = [];
      const content = [];
      
      // Add text prompt
      content.push({ type: 'text', text: prompt });
      
      // Add images if provided
      if (images.length > 0) {
        for (const image of images) {
          content.push({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${image}` }
          });
        }
      }
      
      messages.push({
        role: 'user',
        content: content
      });

      const payload = {
        model: LLM_CONFIG.imageModel,
        messages: messages,
        max_tokens: 4096,
        temperature: 0.7
      };

      const response = await axios.post(
        `${LLM_CONFIG.baseUrl}/chat/completions`,
        payload,
        { 
          timeout: 120000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.choices?.[0]?.message?.content || '';
    } else {
      throw new Error('Unsupported LLM provider');
    }
  } catch (error) {
    console.error('LLM Error:', error.message);
    throw error;
  }
}

// Determine storage rules based on alcohol type (RULE-BASED, not AI-inferred)
function getStorageRules(type, varietal) {
  const typeLower = (type || '').toLowerCase();
  const varietalLower = (varietal || '').toLowerCase();
  
  // Check for spirits first
  const isSpirit = typeLower.includes('cognac') || typeLower.includes('whiskey') || 
                   typeLower.includes('vodka') || typeLower.includes('rum') ||
                   typeLower.includes('tequila') || typeLower.includes('gin') ||
                   typeLower.includes('brandy') || typeLower.includes('schnapps') ||
                   varietalLower.includes('cognac') || varietalLower.includes('whiskey') ||
                   varietalLower.includes('bourbon') || varietalLower.includes('scotch');
  
  // Check for sparkling/champagne
  const isSparkling = typeLower.includes('champagne') || typeLower.includes('sparkling') ||
                      varietalLower.includes('prosecco') || varietalLower.includes('cava') ||
                      varietalLower.includes('franc') || typeLower.includes('franc');
  
  // Check for white wine
  const isWhiteWine = typeLower.includes('white') || varietalLower.includes('chardonnay') ||
                      varietalLower.includes('sauvignon') || varietalLower.includes('riesling') ||
                      varietalLower.includes('pinot grigio') || varietalLower.includes('semillon');
  
  // Check for red wine
  const isRedWine = typeLower.includes('red') || varietalLower.includes('cabernet') ||
                    varietalLower.includes('merlot') || varietalLower.includes('pinot noir') ||
                    varietalLower.includes('syrah') || varietalLower.includes('shiraz') ||
                    varietalLower.includes('malbec') || varietalLower.includes('sangiovese') ||
                    varietalLower.includes('barbera') || varietalLower.includes('tempranillo');
  
  // Check for fortified wines
  const isFortified = typeLower.includes('port') || typeLower.includes('sherry') ||
                      typeLower.includes('marsala') || typeLower.includes('vermouth') ||
                      varietalLower.includes('port') || varietalLower.includes('sherry');
  
  // Default to wine if it contains "wine"
  const isWine = typeLower.includes('wine') || varietalLower.includes('wine') || isRedWine || isWhiteWine || isSparkling || isFortified;
  
  if (isSpirit) {
    return {
      storage_position: 'vertical',
      recommended_temp: '15-20°C',
      needs_cooler: false,
      tempNote: 'Room temperature storage'
    };
  } else if (isSparkling) {
    return {
      storage_position: 'horizontal',
      recommended_temp: '7-10°C',
      needs_cooler: true,
      tempNote: 'Keep chilled'
    };
  } else if (isFortified) {
    return {
      storage_position: 'horizontal',
      recommended_temp: '12-18°C',
      needs_cooler: false,
      tempNote: 'Cool, dark place'
    };
  } else if (isWhiteWine) {
    return {
      storage_position: 'horizontal',
      recommended_temp: '7-12°C',
      needs_cooler: true,
      tempNote: 'Refrigerated storage'
    };
  } else if (isRedWine) {
    return {
      storage_position: 'horizontal',
      recommended_temp: '12-18°C',
      needs_cooler: false,
      tempNote: 'Cool, stable temperature'
    };
  } else if (isWine) {
    // Default wine
    return {
      storage_position: 'horizontal',
      recommended_temp: '12-18°C',
      needs_cooler: false,
      tempNote: 'Cool, dark place'
    };
  }
  
  // Default fallback
  return {
    storage_position: 'vertical',
    recommended_temp: '15-20°C',
    needs_cooler: false,
    tempNote: 'Room temperature storage'
  };
}

// Parse LLM response into structured data
function parseLLMResponse(text, alcoholType = '') {
  const result = {
    name: '',
    brand: '',
    varietal: '',
    region: '',
    country: '',
    vintage: null,
    summary: '',
    background: '',
    flavor_profile: '',
    food_pairings: [],
    ideal_drink_by: '',
    storage_position: '',
    needs_cooler: false,
    recommended_temp: ''
  };

  // Extract structured fields first
  const nameMatch = text.match(/Name[:\s]*(.*?)(?=Brand|$)/is);
  result.name = nameMatch ? nameMatch[1].trim() : '';

  const brandMatch = text.match(/Brand[:\s]*(.*?)(?=Varietal|$)/is);
  result.brand = brandMatch ? brandMatch[1].trim() : '';

  const varietalMatch = text.match(/Varietal[:\s]*(.*?)(?=Region|$)/is);
  result.varietal = varietalMatch ? varietalMatch[1].trim() : '';

  const regionMatch = text.match(/Region[:\s]*(.*?)(?=Country|$)/is);
  result.region = regionMatch ? regionMatch[1].trim() : '';

  const countryMatch = text.match(/Country[:\s]*(.*?)(?=Vintage|$)/is);
  result.country = countryMatch ? countryMatch[1].trim() : '';

  const vintageMatch = text.match(/Vintage[:\s]*(\d{4})/i);
  if (vintageMatch) {
    result.vintage = parseInt(vintageMatch[1]);
  }

  // Extract summary
  const summaryMatch = text.match(/Summary[:\s]*(.*?)(?=Background|$)/is);
  result.summary = summaryMatch ? summaryMatch[1].trim() : '';

  // Extract background
  const backgroundMatch = text.match(/Background[:\s]*(.*?)(?=Flavor|$)/is);
  result.background = backgroundMatch ? backgroundMatch[1].trim() : '';

  // Extract flavor profile
  const flavorMatch = text.match(/Flavor Profile[:\s]*(.*?)(?=Food|$)/is);
  result.flavor_profile = flavorMatch ? flavorMatch[1].trim() : '';

  // Extract food pairings
  const pairingsMatch = text.match(/Food Pairings[:\s]*(.*?)(?=Ideal|$)/is);
  if (pairingsMatch) {
    result.food_pairings = pairingsMatch[1]
      .split(/[\n,]/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  // Extract ideal drink by
  const drinkByMatch = text.match(/Ideal Drink By[:\s]*(.*?)(?=Storage|$)/is);
  result.ideal_drink_by = drinkByMatch ? drinkByMatch[1].trim() : '';

  // Extract storage info - but override based on alcohol type
  const storageMatch = text.match(/Storage[:\s]*(.*?)$/is);
  if (storageMatch) {
    const storageText = storageMatch[1].toLowerCase();
    
    // Determine storage position based on alcohol type
    const isWine = alcoholType.toLowerCase().includes('wine') || 
                   alcoholType.toLowerCase().includes('sparkling') ||
                   result.varietal.toLowerCase().includes('wine');
    const isSpirits = alcoholType.toLowerCase().includes('cognac') || 
                      alcoholType.toLowerCase().includes('whiskey') ||
                      alcoholType.toLowerCase().includes('vodka') ||
                      alcoholType.toLowerCase().includes('rum') ||
                      alcoholType.toLowerCase().includes('tequila') ||
                      alcoholType.toLowerCase().includes('gin') ||
                      alcoholType.toLowerCase().includes('brandy') ||
                      result.varietal.toLowerCase().includes('cognac') ||
                      result.varietal.toLowerCase().includes('whiskey');
    
    // Spirits should be stored VERTICALLY, wines HORIZONTALLY
    if (isSpirits) {
      result.storage_position = 'vertical';
    } else if (isWine) {
      result.storage_position = 'horizontal';
    } else {
      // Default to what AI suggests if unclear
      result.storage_position = storageText.includes('horizontal') || storageText.includes('sideways') 
        ? 'horizontal' 
        : 'vertical';
    }
    
    result.needs_cooler = storageText.includes('cooler') || storageText.includes('fridge') || storageText.includes('cellar');
    
    // Extract temperature with unit - CRITICAL: validate and convert if needed
    const tempMatch = storageText.match(/(\d+)[^\d]*(\d+)?[^\d]*(f|c)/i);
    if (tempMatch) {
      let tempValue = parseInt(tempMatch[1]);
      const unit = tempMatch[3].toLowerCase();
      
      // Validate temperature ranges and convert to Celsius for storage
      // Wine storage: typically 45-65°F (7-18°C)
      // If temp is > 40 and unit is F, convert to C
      // If temp is > 10 and unit is C, it's likely already in C
      if (unit === 'f') {
        // Fahrenheit detected - convert to Celsius for standardization
        // Also validate: wine should be stored between 45-65°F (7-18°C)
        if (tempValue >= 45 && tempValue <= 65) {
          // Valid wine storage temp in F, convert to C
          tempValue = Math.round((tempValue - 32) * 5 / 9);
          result.recommended_temp = `${tempValue}°C`;
        } else if (tempValue > 100) {
          // Clearly wrong - likely meant to be C but AI said F, or vice versa
          // If someone says "130°F" for wine storage, they probably meant "13°C"
          // This is a safety check for extreme values
          result.recommended_temp = `${tempValue}°F (VERIFY - extremely hot)`;
        } else {
          result.recommended_temp = `${tempValue}°F`;
        }
      } else if (unit === 'c') {
        // Celsius detected - validate range
        if (tempValue > 40) {
          // 55°C = 131°F - this would RUIN wine! Likely an error
          // This is probably meant to be Fahrenheit (55°F = 12.8°C)
          // Convert from what was likely a mistaken C to actual F value interpreted as C
          const fahrenheitValue = Math.round(tempValue * 9 / 5 + 32);
          result.recommended_temp = `${tempValue}°C (ERROR: likely meant ${tempValue}°F = ${Math.round((tempValue - 32) * 5 / 9)}°C)`;
        } else if (tempValue >= 7 && tempValue <= 18) {
          // Valid wine storage temp in C
          const fahrenheitValue = Math.round(tempValue * 9 / 5 + 32);
          result.recommended_temp = `${tempValue}°C (${fahrenheitValue}°F)`;
        } else {
          result.recommended_temp = `${tempValue}°C`;
        }
      }
    }
  }

  return result;
}

// API Routes

// Get all bottles
app.get('/api/bottles', (req, res) => {
  try {
    const result = db().exec(`
      SELECT b.*, l.name as location_name
      FROM bottles b
      LEFT JOIN locations l ON b.location_id = l.id
      ORDER BY b.created_at DESC
    `);
    const bottles = result.length > 0 ? result[0].values.map(row => ({
      id: row[0],
      name: row[1],
      brand: row[2],
      type: row[3],
      varietal: row[4],
      region: row[5],
      country: row[6],
      vintage: row[7],
      volume_ml: row[8],
      quantity: row[9],
      price_paid: row[10],
      market_price: row[11],
      market_price_data: row[12],
      last_price_search: row[13],
      location_id: row[14],
      front_label_path: row[15],
      back_label_path: row[16],
      summary: row[17],
      background: row[18],
      flavor_profile: row[19],
      food_pairings: row[20],
      ideal_drink_by: row[21],
      storage_instructions: row[22],
      recommended_temp: row[23],
      storage_position: row[24],
      needs_cooler: row[25],
      ai_analyzed: row[26],
      created_at: row[27],
      updated_at: row[28],
      location_name: row[29]
    })) : [];
    res.json(bottles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single bottle
app.get('/api/bottles/:id', (req, res) => {
  try {
    const result = db().exec(`
      SELECT b.*, l.name as location_name
      FROM bottles b
      LEFT JOIN locations l ON b.location_id = l.id
      WHERE b.id = ${req.params.id}
    `);
    
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Bottle not found' });
    }
    
    const row = result[0].values[0];
    const bottle = {
      id: row[0],
      name: row[1],
      brand: row[2],
      type: row[3],
      varietal: row[4],
      region: row[5],
      country: row[6],
      vintage: row[7],
      volume_ml: row[8],
      quantity: row[9],
      price_paid: row[10],
      market_price: row[11],
      market_price_data: row[12],
      last_price_search: row[13],
      location_id: row[14],
      front_label_path: row[15],
      back_label_path: row[16],
      summary: row[17],
      background: row[18],
      flavor_profile: row[19],
      food_pairings: row[20],
      ideal_drink_by: row[21],
      storage_instructions: row[22],
      recommended_temp: row[23],
      storage_position: row[24],
      needs_cooler: row[25],
      ai_analyzed: row[26],
      created_at: row[27],
      updated_at: row[28],
      location_name: row[29]
    };
    res.json(bottle);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new bottle
app.post('/api/bottles', (req, res) => {
  try {
    const {
      name, brand, type, varietal, region, country, vintage,
      volume_ml, quantity, price_paid, market_price, location_id,
      front_label_path, back_label_path, summary, background,
      flavor_profile, food_pairings, ideal_drink_by, storage_instructions,
      recommended_temp, storage_position, needs_cooler
    } = req.body;

    db().run(`
      INSERT INTO bottles (
        name, brand, type, varietal, region, country, vintage,
        volume_ml, quantity, price_paid, market_price, location_id,
        front_label_path, back_label_path, summary, background,
        flavor_profile, food_pairings, ideal_drink_by, storage_instructions,
        recommended_temp, storage_position, needs_cooler, ai_analyzed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      name, brand, type, varietal, region, country, vintage,
      volume_ml || 750, quantity || 1, price_paid, market_price, location_id || null,
      front_label_path || null, back_label_path || null,
      summary || null, background || null, flavor_profile || null,
      food_pairings ? JSON.stringify(food_pairings) : null,
      ideal_drink_by || null, storage_instructions || null,
      recommended_temp || null, storage_position || null,
      needs_cooler ? 1 : 0, 0
    ]);

    const lastId = db().exec("SELECT last_insert_rowid()");
    res.json({ id: lastId[0].values[0][0], ...req.body });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update bottle
app.put('/api/bottles/:id', (req, res) => {
  try {
    const {
      name, brand, type, varietal, region, country, vintage,
      volume_ml, quantity, price_paid, market_price, market_price_data, last_price_search, location_id,
      summary, background, flavor_profile, food_pairings, ideal_drink_by,
      storage_instructions, recommended_temp, storage_position, needs_cooler
    } = req.body;

    db().run(`
      UPDATE bottles SET
        name = ?, brand = ?, type = ?, varietal = ?, region = ?, country = ?,
        vintage = ?, volume_ml = ?, quantity = ?, price_paid = ?, market_price = ?,
        market_price_data = ?, last_price_search = ?,
        location_id = ?, summary = ?, background = ?, flavor_profile = ?,
        food_pairings = ?, ideal_drink_by = ?, storage_instructions = ?,
        recommended_temp = ?, storage_position = ?, needs_cooler = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      name, brand, type, varietal, region, country, vintage,
      volume_ml || 750, quantity || 1, price_paid, market_price,
      market_price_data ? JSON.stringify(market_price_data) : null, last_price_search || null,
      location_id || null, summary || null, background || null, flavor_profile || null,
      food_pairings ? JSON.stringify(food_pairings) : null,
      ideal_drink_by || null, storage_instructions || null,
      recommended_temp || null, storage_position || null,
      needs_cooler ? 1 : 0, req.params.id
    ]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete bottle
app.delete('/api/bottles/:id', (req, res) => {
  try {
    db().run('DELETE FROM bottles WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload images and analyze with LLM
app.post('/api/upload-and-analyze', upload.fields([
  { name: 'front_label', maxCount: 1 },
  { name: 'back_label', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, brand, type, location_id } = req.body;
    
    let frontLabelPath = null;
    let backLabelPath = null;
    const images = [];
    let needsAnalysis = false;

    if (req.files['front_label']) {
      frontLabelPath = `/uploads/labels/${req.files['front_label'][0].filename}`;
      const frontBuffer = fs.readFileSync(req.files['front_label'][0].path);
      images.push(frontBuffer.toString('base64'));
      needsAnalysis = true;
    }

    if (req.files['back_label']) {
      backLabelPath = `/uploads/labels/${req.files['back_label'][0].filename}`;
      const backBuffer = fs.readFileSync(req.files['back_label'][0].path);
      images.push(backBuffer.toString('base64'));
      needsAnalysis = true;
    }

    // Only generate AI analysis if new images were uploaded
    let analysis = {};
    if (needsAnalysis && images.length > 0) {
      // Create prompt for LLM - extracts structured data
      const prompt = `You are a wine and alcohol expert. Analyze the bottle label images and extract ALL available information.

Extract the following information in this exact format:

Name: [Full product name as it appears on label]
Brand: [Producer/winery/distillery name]
Varietal: [Grape variety or spirit type, e.g., Cabernet Sauvignon, Cognac]
Region: [Production region, e.g., Bordeaux, Napa Valley]
Country: [Country of origin]
Vintage: [Year if visible, otherwise "N/A"]

Summary: [Brief description of this alcohol based on what you can see from the label]

Background: [Origin, winery/distillery history, production process based on label info]

Flavor Profile: [Tasting notes, aroma, body, finish - infer from type if not explicitly stated]

Food Pairings:
- [Food 1]
- [Food 2]
- [Food 3]

Ideal Drink By: [Recommended drinking timeframe based on type]

Storage: [How to store - position (horizontal/vertical), temperature range with UNITS clearly specified, whether it needs a wine cooler]

CRITICAL TEMPERATURE RULES:
- ALWAYS specify the temperature unit clearly (°C or °F)
- Wine storage temperature: 7-18°C (45-65°F) - DO NOT confuse Celsius and Fahrenheit
- 55°F = 13°C (correct wine storage temp)
- 55°C = 131°F (WILL RUIN WINE - this is extremely hot!)
- If you mention a temperature, always include the unit (e.g., "55°F" or "13°C")

Be specific and accurate. Extract exactly what you can see from the labels. If information is not visible, use "N/A" or make reasonable inferences based on the type of alcohol.`;

      try {
        const llmResponse = await callLLM(prompt, images);
        analysis = parseLLMResponse(llmResponse);
        console.log('AI Analysis completed successfully');
        console.log('Extracted:', {
          name: analysis.name,
          brand: analysis.brand,
          varietal: analysis.varietal,
          vintage: analysis.vintage
        });
      } catch (llmError) {
        console.log('LLM not available, using basic info only');
      }
    }

    // Use AI-extracted values if available, otherwise use form values
    const finalName = analysis.name || name || 'Unknown Bottle';
    const finalBrand = analysis.brand || brand || null;
    const finalVarietal = analysis.varietal || null;
    const finalRegion = analysis.region || null;
    const finalCountry = analysis.country || null;
    const finalVintage = analysis.vintage || null;
    
    // Apply rule-based storage (overrides AI inference for consistency)
    const storageRules = getStorageRules(type || finalVarietal || '', finalVarietal || '');
    const finalStoragePosition = analysis.storage_position || storageRules.storage_position;
    const finalRecommendedTemp = analysis.recommended_temp || storageRules.recommended_temp;
    const finalNeedsCooler = analysis.needs_cooler !== undefined ? analysis.needs_cooler : storageRules.needs_cooler;

    console.log('Applied storage rules:', {
      type: type || finalVarietal,
      position: finalStoragePosition,
      temp: finalRecommendedTemp,
      cooler: finalNeedsCooler
    });

    // Insert bottle into database
    db().run(`
      INSERT INTO bottles (
        name, brand, type, varietal, region, country, vintage,
        front_label_path, back_label_path,
        summary, background, flavor_profile, food_pairings,
        ideal_drink_by, storage_instructions, recommended_temp,
        storage_position, needs_cooler, ai_analyzed, location_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      finalName,
      finalBrand,
      type || null,
      finalVarietal,
      finalRegion,
      finalCountry,
      finalVintage,
      frontLabelPath,
      backLabelPath,
      analysis.summary || null,
      analysis.background || null,
      analysis.flavor_profile || null,
      analysis.food_pairings.length > 0 ? JSON.stringify(analysis.food_pairings) : null,
      analysis.ideal_drink_by || null,
      null,
      finalRecommendedTemp || null,
      finalStoragePosition || null,
      finalNeedsCooler ? 1 : 0,
      needsAnalysis ? 1 : 0,
      location_id || null
    ]);

    const lastId = db().exec("SELECT last_insert_rowid()");
    const newId = lastId[0].values[0][0];
    
    saveDatabase();

    res.json({
      id: newId,
      analysis: {
        ...analysis,
        name: finalName,
        brand: finalBrand,
        varietal: finalVarietal,
        region: finalRegion,
        country: finalCountry,
        vintage: finalVintage
      },
      front_label_path: frontLabelPath,
      back_label_path: backLabelPath,
      ai_analyzed: needsAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all locations
app.get('/api/locations', (req, res) => {
  try {
    const result = db().exec('SELECT * FROM locations ORDER BY name');
    const locations = result.length > 0 ? result[0].values.map(row => ({
      id: row[0],
      name: row[1],
      description: row[2],
      storage_type: row[3],
      temperature_controlled: row[4],
      created_at: row[5]
    })) : [];
    res.json(locations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add location
app.post('/api/locations', (req, res) => {
  try {
    const { name, description, storage_type, temperature_controlled } = req.body;
    db().run(
      'INSERT INTO locations (name, description, storage_type, temperature_controlled) VALUES (?, ?, ?, ?)',
      [name, description, storage_type, temperature_controlled ? 1 : 0]
    );
    const lastId = db().exec("SELECT last_insert_rowid()");
    res.json({ id: lastId[0].values[0][0], ...req.body });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search market price for a bottle using SerpApi Google Shopping
app.get('/api/search-market-price', async (req, res) => {
  try {
    const { name, brand, varietal, vintage, bottle_id } = req.query;
    
    if (!name && !brand) {
      return res.status(400).json({ error: 'Product name or brand is required' });
    }

    // Build search query
    const searchQuery = [
      brand || '',
      name || '',
      varietal || '',
      vintage ? `${vintage}` : ''
    ].filter(Boolean).join(' ');

    const searchTerms = `${searchQuery} alcohol wine spirit price`;

    if (SEARCH_CONFIG.provider === 'serpapi' && SEARCH_CONFIG.apiKey) {
      // Use SerpApi for Google Shopping search
      const searchUrl = `https://serpapi.com/search?engine=google_shopping&q=${encodeURIComponent(searchTerms)}&api_key=${SEARCH_CONFIG.apiKey}`;
      
      const searchResponse = await axios.get(searchUrl, { timeout: 15000 });
      
      if (searchResponse.data.shopping_results && searchResponse.data.shopping_results.length > 0) {
        const products = searchResponse.data.shopping_results.slice(0, 10).map(p => ({
          title: p.title,
          price: p.price || 'N/A',
          source: p.source || 'Unknown',
          link: p.link || p.product_link || '#'
        }));
        
        // Calculate price statistics
        const prices = products
          .filter(p => p.price && p.price !== 'N/A')
          .map(p => {
            const num = parseFloat(p.price.replace(/[^0-9.]/g, ''));
            return isNaN(num) ? null : num;
          })
          .filter(p => p !== null);
        
        const priceStats = prices.length > 0 ? {
          min: Math.min(...prices).toFixed(2),
          max: Math.max(...prices).toFixed(2),
          average: (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)
        } : null;
        
        const resultData = {
          query: searchTerms,
          results: products,
          priceStats,
          message: `Found ${products.length} pricing results`
        };

        // Save to database if bottle_id provided
        if (bottle_id) {
          const marketPrice = priceStats ? parseFloat(priceStats.average) : null;
          db().run(`
            UPDATE bottles SET
              market_price = ?,
              market_price_data = ?,
              last_price_search = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [marketPrice, JSON.stringify(resultData), bottle_id]);
          saveDatabase();
        }
        
        res.json(resultData);
      } else {
        const resultData = {
          query: searchTerms,
          results: [],
          message: 'No pricing results found. Try searching manually on Wine-Searcher or Vivino.'
        };

        // Save empty result to database if bottle_id provided
        if (bottle_id) {
          db().run(`
            UPDATE bottles SET
              market_price_data = ?,
              last_price_search = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [JSON.stringify(resultData), bottle_id]);
          saveDatabase();
        }

        res.json(resultData);
      }
    } else {
      // Fallback to Wine-Searcher link
      const wineSearcherUrl = `https://www.wine-searcher.com/find/${encodeURIComponent(searchQuery.replace(/\s+/g, '+'))}`;
      const resultData = {
        query: searchTerms,
        results: [],
        wineSearcherUrl: wineSearcherUrl,
        message: 'Click the link below to search Wine-Searcher for current market prices'
      };

      // Save to database if bottle_id provided
      if (bottle_id) {
        db().run(`
          UPDATE bottles SET
            market_price_data = ?,
            last_price_search = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [JSON.stringify(resultData), bottle_id]);
        saveDatabase();
      }

      res.json(resultData);
    }
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
});

// Get cached market price for a bottle
app.get('/api/bottles/:id/market-price', (req, res) => {
  try {
    const result = db().exec(`
      SELECT market_price, market_price_data, last_price_search
      FROM bottles
      WHERE id = ${req.params.id}
    `);
    
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Bottle not found' });
    }
    
    const row = result[0].values[0];
    res.json({
      market_price: row[0],
      market_price_data: row[1] ? JSON.parse(row[1]) : null,
      last_price_search: row[2]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Re-analyze bottle with AI to update storage position and other fields
app.post('/api/bottles/:id/reanalyze', async (req, res) => {
  try {
    const bottleId = req.params.id;
    
    // Get bottle info
    const bottleResult = db().exec(`
      SELECT front_label_path, back_label_path, name, brand, type, varietal
      FROM bottles WHERE id = ${bottleId}
    `);
    
    if (bottleResult.length === 0 || bottleResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Bottle not found' });
    }
    
    const row = bottleResult[0].values[0];
    const frontLabelPath = row[0];
    const backLabelPath = row[1];
    const name = row[2] || '';
    const brand = row[3] || '';
    const type = row[4] || '';
    const varietal = row[5] || '';
    
    console.log('Re-analyzing bottle', bottleId, '- Type:', type, 'Varietal:', varietal);
    
    // Load images and convert to base64
    const images = [];
    if (frontLabelPath) {
      const fullPath = path.join(__dirname, frontLabelPath);
      if (fs.existsSync(fullPath)) {
        const buffer = fs.readFileSync(fullPath);
        images.push(buffer.toString('base64'));
        console.log('Loaded front label image');
      } else {
        console.log('Front label path not found:', fullPath);
      }
    }
    if (backLabelPath) {
      const fullPath = path.join(__dirname, backLabelPath);
      if (fs.existsSync(fullPath)) {
        const buffer = fs.readFileSync(fullPath);
        images.push(buffer.toString('base64'));
        console.log('Loaded back label image');
      } else {
        console.log('Back label path not found:', fullPath);
      }
    }
    
    if (images.length === 0) {
      return res.status(400).json({ error: 'No images found for this bottle' });
    }
    
    // Create prompt for re-analysis
    const prompt = `You are a wine and alcohol expert. Analyze the bottle label images and extract ALL available information.

Extract the following information in this exact format:

Name: [Full product name as it appears on label]
Brand: [Producer/winery/distillery name]
Varietal: [Grape variety or spirit type, e.g., Cabernet Sauvignon, Cognac]
Region: [Production region, e.g., Bordeaux, Napa Valley]
Country: [Country of origin]
Vintage: [Year if visible, otherwise "N/A"]

Summary: [Brief description of this alcohol based on what you can see from the label]

Background: [Origin, winery/distillery history, production process based on label info]

Flavor Profile: [Tasting notes, aroma, body, finish - infer from type if not explicitly stated]

Food Pairings:
- [Food 1]
- [Food 2]
- [Food 3]

Ideal Drink By: [Recommended drinking timeframe based on type]

Storage: [How to store - position (horizontal/vertical), temperature range with UNITS clearly specified, whether it needs a wine cooler]

CRITICAL TEMPERATURE RULES:
- ALWAYS specify the temperature unit clearly (°C or °F)
- Wine storage temperature: 7-18°C (45-65°F) - DO NOT confuse Celsius and Fahrenheit
- 55°F = 13°C (correct wine storage temp)
- 55°C = 131°F (WILL RUIN WINE - this is extremely hot!)
- If you mention a temperature, always include the unit (e.g., "55°F" or "13°C")

IMPORTANT STORAGE RULES:
- WINE and CHAMPAGNE should be stored HORIZONTALLY (on their side) to keep the cork moist
- SPIRITS (Cognac, Whiskey, Vodka, Rum, Tequila, Gin, Brandy) should be stored VERTICALLY (upright) to prevent damage to the cork from high alcohol content

Be specific and accurate. Extract exactly what you can see from the labels.`;

    let analysis = {};
    try {
      console.log('Calling LLM for re-analysis...');
      const llmResponse = await callLLM(prompt, images);
      console.log('LLM response received, length:', llmResponse?.length);
      analysis = parseLLMResponse(llmResponse || '', type || varietal || '');
      console.log('Re-analysis completed for bottle', bottleId);
      console.log('Parsed analysis:', {
        name: analysis.name,
        storage_position: analysis.storage_position,
        recommended_temp: analysis.recommended_temp,
        needs_cooler: analysis.needs_cooler
      });
    } catch (llmError) {
      console.error('LLM error for re-analysis:', llmError.message);
      return res.status(503).json({ error: 'LLM service unavailable: ' + llmError.message });
    }
    
    // Apply rule-based storage (overrides AI inference for consistency)
    const storageRules = getStorageRules(type || varietal || '', varietal || '');
    const finalStoragePosition = analysis.storage_position || storageRules.storage_position;
    const finalRecommendedTemp = analysis.recommended_temp || storageRules.recommended_temp;
    const finalNeedsCooler = analysis.needs_cooler !== undefined ? analysis.needs_cooler : storageRules.needs_cooler;
    
    console.log('Applied storage rules for re-analysis:', {
      type: type || varietal,
      position: finalStoragePosition,
      temp: finalRecommendedTemp,
      cooler: finalNeedsCooler
    });
    
    // Update database with new analysis
    db().run(`
      UPDATE bottles SET
        name = ?, brand = ?, varietal = ?, region = ?, country = ?, vintage = ?,
        summary = ?, background = ?, flavor_profile = ?,
        food_pairings = ?, ideal_drink_by = ?,
        recommended_temp = ?, storage_position = ?, needs_cooler = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      analysis.name || name,
      analysis.brand || brand,
      analysis.varietal || varietal,
      analysis.region || null,
      analysis.country || null,
      analysis.vintage || null,
      analysis.summary || null,
      analysis.background || null,
      analysis.flavor_profile || null,
      analysis.food_pairings.length > 0 ? JSON.stringify(analysis.food_pairings) : null,
      analysis.ideal_drink_by || null,
      finalRecommendedTemp || null,
      finalStoragePosition || null,
      finalNeedsCooler ? 1 : 0,
      bottleId
    ]);
    
    saveDatabase();
    
    res.json({
      success: true,
      analysis: {
        name: analysis.name || name,
        brand: analysis.brand || brand,
        varietal: analysis.varietal || varietal,
        storage_position: finalStoragePosition || 'N/A',
        recommended_temp: finalRecommendedTemp || 'N/A',
        needs_cooler: finalNeedsCooler
      }
    });
  } catch (error) {
    console.error('Re-analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get inventory statistics
app.get('/api/stats', (req, res) => {
  try {
    const totalBottlesResult = db().exec('SELECT COUNT(*) as count FROM bottles');
    const totalBottles = totalBottlesResult.length > 0 ? totalBottlesResult[0].values[0][0] : 0;
    
    const totalQuantityResult = db().exec('SELECT COALESCE(SUM(quantity), 0) as sum FROM bottles');
    const totalQuantity = totalQuantityResult.length > 0 ? totalQuantityResult[0].values[0][0] : 0;
    
    const typeBreakdownResult = db().exec('SELECT type, COUNT(*) as count, SUM(quantity) as total_qty FROM bottles GROUP BY type');
    const typeBreakdown = typeBreakdownResult.length > 0 ? typeBreakdownResult[0].values.map(row => ({
      type: row[0],
      count: row[1],
      total_qty: row[2]
    })) : [];
    
    const locationBreakdownResult = db().exec(`
      SELECT l.name, COUNT(b.id) as count, SUM(b.quantity) as total_qty
      FROM bottles b
      LEFT JOIN locations l ON b.location_id = l.id
      GROUP BY l.name
    `);
    const locationBreakdown = locationBreakdownResult.length > 0 ? locationBreakdownResult[0].values.map(row => ({
      name: row[0],
      count: row[1],
      total_qty: row[2]
    })) : [];

    res.json({
      totalBottles,
      totalQuantity,
      typeBreakdown,
      locationBreakdown
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve the main app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize server
async function startServer() {
  try {
    await initDatabase();
    appReady = true;
    
    app.listen(PORT, () => {
      console.log(`RedWine Inventory Server running on http://localhost:${PORT}`);
      console.log(`LLM Provider: ${LLM_CONFIG.provider}`);
      console.log(`LLM Base URL: ${LLM_CONFIG.baseUrl}`);
      console.log(`LLM Model: ${LLM_CONFIG.model}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

startServer();
