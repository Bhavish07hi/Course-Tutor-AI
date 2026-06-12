import os
import re
import pickle
import numpy as np
import faiss
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from groq import Groq
from PyPDF2 import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer, CrossEncoder

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

app = Flask(__name__)
UPLOAD_FOLDER = "uploads"
VECTOR_FOLDER = "vectorstore"
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["VECTOR_FOLDER"] = VECTOR_FOLDER

# Core Global Models
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
reranker_model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

# Memory Cache for quick operational reuse
session_storage = {}

def get_session_context(session_id):
    """Initializes, accesses, or reloads persistent vectors from disk for an isolated session."""
    if not session_id:
        session_id = "default_session"
        
    if session_id in session_storage:
        return session_storage[session_id]

    # Check Disk State for restoration
    index_path = os.path.join(app.config["VECTOR_FOLDER"], f"{session_id}.index")
    data_path = os.path.join(app.config["VECTOR_FOLDER"], f"{session_id}_chunks.pkl")

    if os.path.exists(index_path) and os.path.exists(data_path):
        try:
            index = faiss.read_index(index_path)
            with open(data_path, "rb") as f:
                disk_data = pickle.load(f)
            
            session_storage[session_id] = {
                "chunks": disk_data["chunks"],
                "files": disk_data["files"],
                "index": index
            }
            print(f"--> Restored session '{session_id}' vectors from persistent disk storage.")
            return session_storage[session_id]
        except Exception as e:
            print(f"--> Persisted session file reload failed: {e}")

    # Fallback initialization state
    session_storage[session_id] = {
        "chunks": [],
        "files": [],
        "index": None
    }
    return session_storage[session_id]

def commit_session_to_disk(session_id, context_dict):
    """Serializes and saves vector indexes and payload blocks to disk storage."""
    if context_dict["index"] is None:
        return
        
    index_path = os.path.join(app.config["VECTOR_FOLDER"], f"{session_id}.index")
    data_path = os.path.join(app.config["VECTOR_FOLDER"], f"{session_id}_chunks.pkl")
    
    try:
        faiss.write_index(context_dict["index"], index_path)
        with open(data_path, "wb") as f:
            pickle.dump({
                "chunks": context_dict["chunks"],
                "files": context_dict["files"]
            }, f)
        print(f"--> Saved changes for session '{session_id}' securely to storage.")
    except Exception as e:
        print(f"--> Error saving vectors down to persistent disk file: {e}")

def extract_session_id():
    """Extracts session keys routing inside payloads or explicit custom header objects."""
    session_id = request.headers.get("X-Session-Id")
    if session_id:
        return str(session_id)
    if request.form and "session_id" in request.form:
        return str(request.form.get("session_id"))
    if request.is_json:
        body = request.get_json()
        if body and "session_id" in body:
            return str(body.get("session_id"))
    return "default_session"

@app.route('/')
def home():
    return render_template("index.html")

@app.route('/upload', methods=['POST'])
def upload_pdf():
    session_id = extract_session_id()
    session_data = get_session_context(session_id)

    if 'pdf' not in request.files:
        return jsonify({"message": "No file selected"})

    file = request.files['pdf']
    if file.filename == "":
        return jsonify({"message": "No file selected"})

    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"message": "Only PDF files are supported."}), 400

    filepath = os.path.join(app.config["UPLOAD_FOLDER"], f"{session_id}_{file.filename}")

    try:
        file.save(filepath)
        reader = PdfReader(filepath)
    except Exception as e:
        return jsonify({"message": f"{file.filename} is not a valid PDF file: {str(e)}"}), 400

    # Cache old chunks in case re-upload yields no content
    backup_chunks = list(session_data["chunks"])
    backup_files = list(session_data["files"])

    # Idempotent State Engine: Handle duplicate uploads cleanly
    if file.filename in session_data["files"]:
        session_data["chunks"] = [c for c in session_data["chunks"] if c["source"] != file.filename]
    else:
        session_data["files"].append(file.filename)

    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"

    # Split arrays protecting structural paragraph boundaries
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1200,
        chunk_overlap=250,
        separators=["\n\n", "\n", ". ", " ", ""]
    )
    new_chunks = splitter.split_text(text)

    for chunk in new_chunks:
        session_data["chunks"].append({
            "text": chunk,
            "source": file.filename
        })

    texts = [chunk["text"] for chunk in session_data["chunks"]]
    
    # Guardrail: Prevent processing crash if no text could be extracted
    if not texts:
        session_data["chunks"] = backup_chunks
        session_data["files"] = backup_files
        return jsonify({"message": f"Upload failed: No extractable text found in {file.filename}."}), 400
    
    # Cosine search conversion requires normalized embeddings
    embeddings = embedding_model.encode(texts, normalize_embeddings=True)
    embeddings = np.array(embeddings).astype("float32")
    dimension = embeddings.shape[1]
    
    # IndexFlatIP maps normalized Inner Products cleanly to True Cosine Similarity
    session_data["index"] = faiss.IndexFlatIP(dimension)
    session_data["index"].add(embeddings)

    commit_session_to_disk(session_id, session_data)

    return jsonify({"message": f"{file.filename} compiled and indexed successfully."})

@app.route('/ask', methods=['POST'])
def ask():
    data = request.get_json() or {}
    question = data.get("question", "").strip()
    
    session_id = extract_session_id()
    session_data = get_session_context(session_id)

    if len(session_data["chunks"]) == 0 or session_data["index"] is None:
        return jsonify({
            "answer": "Please upload a PDF first.",
            "source": "No document indexed in this session runtime thread space.",
            "document": "No Document"
        })

    # Regex-driven parsing updated to strip pronoun headers including how/when
    clean_core = re.sub(r'(?i)^(what is|which|who|where|how|when|explain|define|tell me about)\s+', '', question)
    
    expansion_queries = [
        question,
        f"definition of {clean_core}",
        f"explain details regarding {clean_core}"
    ]
    
    seen_chunk_indices = set()
    raw_retrieved_nodes = []
    best_document = "Unknown"

    # Core Vector Retrieval Pipeline
    for q in expansion_queries:
        q_emb = embedding_model.encode([q], normalize_embeddings=True)
        q_emb = np.array(q_emb).astype("float32")
        
        scores, indices = session_data["index"].search(q_emb, 8)
        
        # Retrieval Telemetry Logging
        print(f"\n[QUERY EXPANSION]: {q}")
        print(f"[COSINE SCORES]  : {scores[0]}")
        
        for score, idx in zip(scores[0], indices[0]):
            if idx < len(session_data["chunks"]):
                if score < 0.05:
                    continue
                if idx not in seen_chunk_indices:
                    seen_chunk_indices.add(idx)
                    raw_retrieved_nodes.append({
                        "idx": idx,
                        "text": session_data["chunks"][idx]["text"],
                        "source": session_data["chunks"][idx]["source"],
                        "vector_score": float(score)
                    })

    if not raw_retrieved_nodes:
        return jsonify({
            "answer": "Answer not found in uploaded notes.",
            "source": "No relevant content cleared the similarity analysis threshold.",
            "document": "Unknown"
        })

    # Performance Optimization: Candidate capping
    candidate_nodes = sorted(raw_retrieved_nodes, key=lambda x: x["vector_score"], reverse=True)[:20]

    # Conditional Reranking Engine: Use vector scores directly for short keyword searches (<= 2 words)
    if len(question.split()) <= 2:
        sorted_nodes = sorted(candidate_nodes, key=lambda x: x["vector_score"], reverse=True)
    else:
        # Cross-Encoder Reranking Execution Layer for structured natural language questions
        rerank_pairs = [[question, node["text"]] for node in candidate_nodes]
        rerank_scores = reranker_model.predict(rerank_pairs)

        for i, score in enumerate(rerank_scores):
            candidate_nodes[i]["rerank_score"] = float(score)

        sorted_nodes = sorted(candidate_nodes, key=lambda x: x["rerank_score"], reverse=True)
    
    # Extract optimal window segments
    final_nodes = sorted_nodes[:4]
    best_document = final_nodes[0]["source"] if final_nodes else "Unknown"

    # Diagnostic Retrieval Telemetry Dump block
    print("\n===== FINAL NODES =====")
    for node in final_nodes:
        print("RERANK:", node.get("rerank_score", "N/A"))
        print("VECTOR:", node["vector_score"])
        print("DOC:", node["source"])
        print(node["text"][:200])
        print("----------------")

    # Relaxed Cutoff Check: Let the LLM handle context validity decisions safely
    if len(final_nodes) == 0:
        return jsonify({
            "answer": "Answer not found in uploaded notes.",
            "source": "Insufficient contextual confidence matches found within knowledge base.",
            "document": best_document
        })

    # Context String Assembly
    context = ""
    for i, node in enumerate(final_nodes):
        context += f"\n\n[RETRIEVED CHUNK {i+1}]\n{node['text']}\n"

    # Context Window Output
    print("\n===== CONTEXT SENT TO LLM =====")
    print(context[:3000])
    print("==============================")

    prompt = f"""You are a strict academic course tutor.

You MUST answer only from the retrieved notes.

RETRIEVED NOTES:
{context}

QUESTION:
{question}

RULES:
1. Use only the retrieved notes.
2. Answer from the notes as best as possible.
3. Do not invent facts not present in notes.
4. If absolutely nothing relevant is found, say:
   Answer not found in uploaded notes.

OUTPUT FORMAT:

ANSWER:
<answer>

SOURCE:
<supporting text>"""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0
        )
        response_text = response.choices[0].message.content
    except Exception as e:
        return jsonify({
            "answer": "System processing timeout parsing generation steps.",
            "source": str(e),
            "document": best_document
        })

    answer = response_text
    source = "No source references found."

    try:
        if "SOURCE:" in response_text:
            parts = response_text.split("SOURCE:", 1)
            answer = parts[0].replace("ANSWER:", "").strip()
            source = re.sub(r"\n{3,}", "\n\n", parts[1]).strip()
    except Exception as e:
        print(f"Output string slice boundary parsing exception: {e}")

    return jsonify({
        "answer": answer,
        "source": source,
        "document": best_document
    })

if __name__ == '__main__':
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
    if not os.path.exists(VECTOR_FOLDER):
        os.makedirs(VECTOR_FOLDER)
    app.run(debug=True)