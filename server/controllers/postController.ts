import { Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { Generation } from "../models/Generation.js";
import { Post } from "../models/Post.js";
import { AuthRequest } from "../middlewares/authMiddleware.js";
import axios from "axios";
import { cloudinary } from "../config/cloudinary.js";

const generateImageWithPollinations = async (prompt: string): Promise<Buffer> => {
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;

  const response = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
};

// Generate post
// POST /api/posts/generate
export const generatePost = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { prompt, tone, generateImage } = req.body;

        const apiKey = process.env.GEMINI_API_KEY;
        if(!apiKey){
            res.status(400).json({message: "Gemini API Key is missing. Please add it to your server/.env file." });
            return;
        }

        const ai = new GoogleGenAI({apiKey});

        // Generate Text
        const textResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Generate a social media post based on this prompt: "${prompt}". 
            Tone: ${tone}. 
            Include relevant hashtags.
            Format the response as JSON with "content" and "imagePrompt" fields. 
            The "imagePrompt" should be a detailed, vivid image-generation prompt (30-50 words) describing subject, setting lighting and visual style (eg: "photorealistic" , "flat illustration", "vibrant colors"). Avoid abstract or vague phrasing- describe exactly what should visually appear in the image.`,
        });

        let content = "";
        let imagePrompt = prompt;

        try {
            const rawText = textResponse.text || "";
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            const data = jsonMatch ? JSON.parse(jsonMatch[0]) : {content: rawText, imagePrompt: prompt};
            content = data.content;
            imagePrompt = data.imagePrompt;
        } catch (e) {
            content = textResponse.text || ""
        }

        let mediaUrl = "";
        if(generateImage){
           try {
                const imageBuffer = await generateImageWithPollinations(imagePrompt);

                const uploadResult = await cloudinary.uploader.upload(
                    `data:image/png;base64,${imageBuffer.toString("base64")}`,
                    { folder: "ai-generations" }
                );

                mediaUrl = uploadResult.secure_url;
           } catch (err: any) {
                console.error("Image generation failed:", err?.message || err);
           } 
        }

         // Save generation to DB
          const generation = await Generation.create({
            user: req.user._id,
            prompt,
            content,
            mediaUrl,
            mediaType: mediaUrl ? "image" : undefined,
            tone
          })

          res.json(generation)
        
    } catch (error: any) {
        res.status(500).json({ message: error?.message || "Server error" });
    }
}


// Get generations
// GET /api/posts/generations
export const getGenerations = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const generations = await Generation.find({user: req.user._id}).sort({createdAt: -1})
        res.json(generations)
    } catch (error: any) {
        res.status(500).json({ message: error?.message || "Server error" });
    }
}


// Get posts
// GET /api/posts
export const getPosts = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const posts = await Post.find({user: req.user._id})
        res.json(posts)
    } catch (error: any) {
        res.status(500).json({ message: error?.message || "Server error" });
    }
}


// Schedule post
// POST /api/posts
export const schedulePost = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { content, platforms, scheduledFor, status } = req.body;

        let parsedPlatforms = platforms;
        if(typeof platforms === "string"){
            try {
                parsedPlatforms = JSON.parse(platforms)
            } catch (e) {
                parsedPlatforms = platforms.split(",");
            }
        }

        let mediaUrl: string | undefined = req.body.mediaUrl;
        let mediaType: "image" | "video" | undefined = req.body.mediaType;

        if(req.file){
            const result = await new Promise<any>((resolve, reject)=>{
                const stream = cloudinary.uploader.upload_stream({resource_type: "auto", folder: "social-scheduler"}, (error, result)=>{
                    if(error) reject(error);
                    else resolve(result)
                });
                stream.end(req.file!.buffer);
            });
            mediaUrl = result.secure_url;
            mediaType = result.resource_type === "video" ? "video" : "image";
        }

        const post = await Post.create({
            user: req.user._id,
            content,
            platforms: parsedPlatforms,
            mediaUrl,
            mediaType,
            scheduledFor,
            status,
        })
        res.status(201).json(post)

    } catch (error: any) {
        res.status(500).json({ message: error?.message || "Server error" });
    }
}