const token = localStorage.getItem("timb3rToken");

if (!token) location.href = "/login.html";

function headers(json=false){
  const h={Authorization:"Bearer "+token};
  if(json) h["Content-Type"]="application/json";
  return h;
}

function esc(value){
  const div=document.createElement("div");
  div.textContent=value ?? "";
  return div.innerHTML;
}

function money(value){
  return "R"+Number(value||0).toLocaleString("en-ZA",{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  });
}

async function api(url,options={}){
  const r=await fetch(url,options);

  if(r.status===401 || r.status===403){
    localStorage.removeItem("timb3rToken");
    location.href="/login.html";
    throw new Error("Admin session expired");
  }

  const data=await r.json();

  if(!r.ok){
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function requireAdmin(){
  const me=await api("/api/me",{headers:headers()});

  if(!["admin","compliance"].includes(me.role)){
    location.href="/login.html";
    throw new Error("Admin access required");
  }

  return me;
}

function logout(){
  localStorage.removeItem("timb3rToken");
  location.href="/login.html";
}
