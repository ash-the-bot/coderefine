from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os

from dotenv import load_dotenv
from groq import Groq
from supabase import create_client, Client


load_dotenv()

app = FastAPI(title="Coderefine API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RefineRequest(BaseModel):
    code: str
    language: str
    goal: Optional[str] = "Improve readability, performance, and structure while preserving behavior."


class RefineResponse(BaseModel):
    refined_code: str
    summary: str
    suggestions: List[str]


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    code_context: str
    language: str
    messages: List[ChatMessage]


class ChatResponse(BaseModel):
    reply: str


class ComplexityAnalysisResponse(BaseModel):
    time_complexity: str
    space_complexity: str
    explanation: str


def get_groq_client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY environment variable is not set.")
    return Groq(api_key=api_key)


def get_supabase_client() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_ANON_KEY")
    if not url or not key:
        return None
    return create_client(url, key)


from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(
            status_code=500, detail="Supabase client not configured."
        )
    
    # Verify the token with Supabase
    try:
        user_response = supabase.auth.get_user(token)
        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=401, detail="Invalid authentication credentials"
            )
        return user_response.user
    except Exception as e:
        raise HTTPException(
            status_code=401, detail="Invalid authentication credentials"
        )


def get_goal_specific_prompt(goal: str) -> tuple:
    """Return (system_prompt, instruction_suffix) based on the selected goal."""
    goal_lower = goal.lower()
    
    if "performance" in goal_lower or "speed" in goal_lower or "algorithmic" in goal_lower:
        system = (
            "You are Coderefine, an expert performance-focused software engineer. "
            "You receive source code and must produce a highly optimized version. "
            "Focus on algorithmic efficiency, reducing time complexity, eliminating redundant operations, "
            "and leveraging language-specific performance features. "
            "Keep behavior identical while making the code as fast as possible. "
            "Support Python, Java, C, C++, Rust, and JavaScript. "
            "Return only valid code in the target language."
        )
        instruction = (
            "Optimize this code for maximum performance and speed. "
            "Reduce time complexity where possible, eliminate redundant loops, "
            "use efficient data structures, and apply algorithmic improvements. "
            "Preserve all functionality exactly as-is."
        )
    elif "idiomatic" in goal_lower or "concise" in goal_lower:
        system = (
            "You are Coderefine, an expert in idiomatic and Pythonic code patterns. "
            "You receive source code and must refactor it to use language-specific idioms and best practices. "
            "Make the code more concise, readable, and aligned with the target language's conventions. "
            "Keep behavior identical while improving expressiveness. "
            "Support Python, Java, C, C++, Rust, and JavaScript. "
            "Return only valid code in the target language."
        )
        instruction = (
            "Refactor this code to be more idiomatic and concise. "
            "Use language-specific idioms, built-in functions, and best practices. "
            "Remove verbosity while keeping all functionality intact. "
            "Make the code express intent more clearly."
        )
    elif "document" in goal_lower or "comment" in goal_lower or "variable" in goal_lower:
        system = (
            "You are Coderefine, an expert code documentation specialist. "
            "You receive source code and must improve its readability through better naming and documentation. "
            "Add clear comments explaining logic, improve variable and function names for clarity, "
            "and structure code for maximum readability. "
            "Keep behavior identical while making code self-documenting. "
            "Support Python, Java, C, C++, Rust, and JavaScript. "
            "Return only valid code in the target language."
        )
        instruction = (
            "Improve code readability and documentation. "
            "Rename variables and functions for clarity, add helpful comments explaining complex logic, "
            "and structure the code logically. Preserve all functionality."
        )
    elif "bug" in goal_lower or "fix" in goal_lower:
        system = (
            "You are Coderefine, an expert code auditor and debugger. "
            "You receive source code and must identify and fix potential bugs, edge cases, and vulnerabilities. "
            "Look for off-by-one errors, null pointer dereferences, type mismatches, edge case handling, "
            "and common pitfalls in the target language. "
            "Fix issues while keeping the intended behavior intact. "
            "Support Python, Java, C, C++, Rust, and JavaScript. "
            "Return only valid code in the target language."
        )
        instruction = (
            "Analyze this code for potential bugs and vulnerabilities. "
            "Find and fix: off-by-one errors, missing null checks, uncaught exceptions, "
            "type mismatches, race conditions, and edge cases. "
            "Make the code robust and production-ready."
        )
    else:  # Default: General Polish
        system = (
            "You are Coderefine, an expert software engineer. "
            "You receive source code and must produce a refined version of the code, "
            "improving readability, performance, and structure while preserving behavior. "
            "Support common languages like Python, Java, C, C++, Rust, and JavaScript. "
            "Balance clarity, efficiency, and maintainability. "
            "Return only valid code in the target language."
        )
        instruction = (
            "Improve this code for better readability, performance, and maintainability. "
            "Apply general best practices, improve structure, and optimize performance where applicable. "
            "Preserve all functionality exactly as-is."
        )
    
    return system, instruction


@app.post("/api/refine", response_model=RefineResponse)
def refine_code(payload: RefineRequest, user = Depends(get_current_user)) -> RefineResponse:
    client = get_groq_client()

    system_prompt, instruction = get_goal_specific_prompt(payload.goal)

    chat_completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"Language: {payload.language}\n\n"
                    f"Original code:\n{payload.code}\n\n"
                    f"Task: {instruction}"
                ),
            },
        ],
    )

    refined_code = chat_completion.choices[0].message.content

    explanation_completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": "Explain code refinements briefly and list concrete suggestions."},
            {
                "role": "user",
                "content": (
                    f"Language: {payload.language}\n\n"
                    f"Original code:\n{payload.code}\n\n"
                    f"Refined code:\n{refined_code}\n\n"
                    "Summarize the key improvements in 2–3 sentences, "
                    "then provide a short bullet list of concrete suggestions."
                ),
            },
        ],
    )

    explanation = explanation_completion.choices[0].message.content
    lines = [line.strip(" -") for line in explanation.splitlines() if line.strip()]
    summary = lines[0] if lines else "Refinement complete."
    suggestions = lines[1:6] if len(lines) > 1 else []

    supabase = get_supabase_client()
    if supabase:
        try:
            supabase.table("refinements").insert(
                {
                    "language": payload.language,
                    "original_code": payload.code,
                    "refined_code": refined_code,
                    "summary": summary,
                }
            ).execute()
        except Exception:
            # Storage failures should not break the main flow.
            pass

    return RefineResponse(refined_code=refined_code, summary=summary, suggestions=suggestions)


@app.post("/api/complexity", response_model=ComplexityAnalysisResponse)
def analyze_complexity(payload: RefineRequest, user = Depends(get_current_user)) -> ComplexityAnalysisResponse:
    """Analyze time and space complexity of code using AI."""
    client = get_groq_client()
    
    complexity_prompt = (
        "You are an expert algorithm analyst. Analyze the provided code and determine its time and space complexity. "
        "Provide the Big-O notation for both. Be precise and consider the actual implementation, not worst-case assumptions. "
        "If there are multiple operations, analyze the dominant one. Format your response as: "
        "TIME_COMPLEXITY: O(...) | SPACE_COMPLEXITY: O(...) | EXPLANATION: brief analysis"
    )
    
    completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": complexity_prompt},
            {
                "role": "user",
                "content": (
                    f"Language: {payload.language}\n\n"
                    f"Analyze the time and space complexity of this code:\n\n{payload.code}"
                ),
            },
        ],
    )
    
    response_text = completion.choices[0].message.content
    
    # Parse the response
    time_complexity = "O(n)"  # defaults
    space_complexity = "O(1)"
    explanation = "Unable to parse complexity"
    
    try:
        # Try to extract from formatted response
        if "TIME_COMPLEXITY:" in response_text and "SPACE_COMPLEXITY:" in response_text:
            parts = response_text.split("|")
            for part in parts:
                part = part.strip()
                if part.startswith("TIME_COMPLEXITY:"):
                    time_complexity = part.replace("TIME_COMPLEXITY:", "").strip()
                elif part.startswith("SPACE_COMPLEXITY:"):
                    space_complexity = part.replace("SPACE_COMPLEXITY:", "").strip()
                elif part.startswith("EXPLANATION:"):
                    explanation = part.replace("EXPLANATION:", "").strip()
        else:
            # Fallback: return full response as explanation
            explanation = response_text[:500]
    except Exception:
        pass
    
    return ComplexityAnalysisResponse(
        time_complexity=time_complexity,
        space_complexity=space_complexity,
        explanation=explanation
    )


@app.post("/api/chat", response_model=ChatResponse)
def chat_about_code(payload: ChatRequest, user = Depends(get_current_user)) -> ChatResponse:
    client = get_groq_client()

    messages = [
        {
            "role": "system",
            "content": (
                "You are Coderefine's code assistant. "
                "You answer questions about the provided code context, "
                "explain behavior, suggest improvements, and help debug while being concise."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Language: {payload.language}\n\n"
                f"Code context:\n{payload.code_context}\n\n"
                "User will now ask questions about this code."
            ),
        },
    ]

    for m in payload.messages:
        messages.append({"role": m.role, "content": m.content})

    completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
    )

    reply = completion.choices[0].message.content

    supabase = get_supabase_client()
    if supabase:
        try:
            supabase.table("chats").insert(
                {
                    "language": payload.language,
                    "code_context": payload.code_context,
                    "messages": [m.model_dump() for m in payload.messages],
                    "reply": reply,
                }
            ).execute()
        except Exception:
            pass

    return ChatResponse(reply=reply)


@app.get("/health")
def health():
    return {"status": "ok"}

